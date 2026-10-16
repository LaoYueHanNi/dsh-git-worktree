import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CancelledError, childProcessExec, fetchAll, GitError, updateBranch, type Exec, type ExecOptions, type ExecResult, type LiveRun } from '../src/git.ts'

/** Run a Node snippet as the "git": a real child process, no git needed. */
const run = (script: string, options: Partial<ExecOptions> = {}): Promise<ExecResult> =>
  childProcessExec(process.execPath, ['-e', script], { cwd: process.cwd(), ...options })

/** Is the pid still alive? */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Wait (bounded) until a predicate holds. */
async function until(predicate: () => boolean, limitMs = 5000): Promise<void> {
  const deadline = Date.now() + limitMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('childProcessExec live run', () => {
  it('streams stdout and stderr chunks as written and still returns them whole', async () => {
    const chunks: string[] = []
    const result = await run(
      'process.stdout.write("out\\n"); setTimeout(() => process.stderr.write("err\\r"), 30); setTimeout(() => process.stderr.write("done\\n"), 60)',
      { onOutput: chunk => { chunks.push(chunk) } },
    )
    expect(result).toEqual({ code: 0, stdout: 'out\n', stderr: 'err\rdone\n' })
    expect(chunks.join('')).toContain('out\n')
    expect(chunks.join('')).toContain('err\rdone\n')
    // Incremental, not one buffered blob at the end.
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  it('reports the real exit code and keeps stderr for the failure message', async () => {
    const result = await run('process.stderr.write("fatal: nope\\n"); process.exit(3)', { onOutput: () => undefined })
    expect(result).toMatchObject({ code: 3, stderr: 'fatal: nope\n' })
    expect(result.cancelled).toBeUndefined()
  })

  it('reports a spawn failure as an ordinary failed result', async () => {
    const result = await childProcessExec('definitely-not-a-real-binary-xyz', [], { cwd: process.cwd(), onOutput: () => undefined })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/ENOENT|not found/i)
  })

  it('kills the process and answers cancelled when the signal aborts', async () => {
    const controller = new AbortController()
    let pid = 0
    const pending = run('console.log(process.pid); setInterval(() => {}, 1000)', {
      signal: controller.signal,
      onOutput: (chunk) => { pid = Number.parseInt(chunk, 10) },
    })
    await until(() => pid > 0)
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ code: 1, cancelled: true })
    await until(() => !alive(pid))
  })

  it('answers cancelled without spawning anything when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await run('require("fs").writeFileSync("should-not-exist.txt", "x")', { signal: controller.signal })
    expect(result).toEqual({ code: 1, stdout: '', stderr: '', cancelled: true })
  })

  it('kills a run that stays silent past the idle timeout and says why', async () => {
    const result = await run('setInterval(() => {}, 1000)', { idleTimeoutMs: 300 })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('timed out')
    expect(result.cancelled).toBeUndefined()
  })

  it('does not time out a run that keeps producing output', async () => {
    const result = await run(
      'let n = 0; const t = setInterval(() => { process.stderr.write("tick\\r"); if (++n === 6) { clearInterval(t) } }, 100)',
      { idleTimeoutMs: 450 },
    )
    expect(result.code).toBe(0)
  })

  it('honours a hard timeout for a live run when one is asked for', async () => {
    const result = await run('setInterval(() => process.stderr.write("."), 50)', { onOutput: () => undefined, timeoutMs: 300 })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('timed out')
  })

  // Windows `child.kill()` ends one pid and leaves what it started running;
  // the tree kill is what makes cancelling a fetch actually stop the download.
  it.runIf(process.platform === 'win32')('takes the processes the child started down with it (Windows)', async () => {
    const controller = new AbortController()
    let grandchild = 0
    const pending = run(
      'const c = require("child_process").spawn(process.execPath, ["-e", "console.log(\\"gc:\\" + process.pid); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "inherit"] }); c.stdout.pipe(process.stdout); setInterval(() => {}, 1000)',
      { signal: controller.signal, onOutput: (chunk) => { const match = /gc:(\d+)/.exec(chunk); if (match?.[1] !== undefined) grandchild = Number(match[1]) } },
    )
    await until(() => grandchild > 0)
    controller.abort()
    await pending
    await until(() => !alive(grandchild))
  })
})

/** An executor that records calls and answers each with the next result. */
function recording(results: Partial<ExecResult>[]): { exec: Exec; calls: { args: readonly string[]; options: ExecOptions }[] } {
  const calls: { args: readonly string[]; options: ExecOptions }[] = []
  const exec: Exec = async (_file, args, options) => {
    calls.push({ args, options })
    return { code: 0, stdout: '', stderr: '', ...results[calls.length - 1] }
  }
  return { exec, calls }
}

/**
 * The two answers a live fetch reads before it transfers anything: `git
 * remote`, then the `skipFetchAll` lookup (exit 1 = no remote is marked).
 */
const listing = (remotes: string[], skipFlags = ''): Partial<ExecResult>[] => [
  { stdout: remotes.map(name => `${name}\n`).join('') },
  skipFlags === '' ? { code: 1 } : { stdout: skipFlags },
]

describe('fetchAll with a live run', () => {
  it('asks git for progress and hands over the output sink and the signal', async () => {
    const { exec, calls } = recording([...listing(['origin']), {}])
    const controller = new AbortController()
    const onOutput = (): void => undefined
    await fetchAll(exec, '/repo', { onOutput, signal: controller.signal })
    expect(calls[2]?.args).toEqual(['fetch', 'origin', '--prune', '--progress'])
    expect(calls[2]?.options).toMatchObject({ cwd: '/repo', onOutput, signal: controller.signal })
    // No whole-run cap that would kill a long transfer; silence is bounded instead.
    expect(calls[2]?.options.timeoutMs).toBeUndefined()
    expect(calls[2]?.options.idleTimeoutMs).toBeGreaterThan(60_000)
  })

  it('fetches the remotes one by one (git gives a `--all` child no --progress) and names each first', async () => {
    const { exec, calls } = recording([...listing(['origin', 'fork']), {}, {}])
    const order: string[] = []
    const spy: Exec = async (file, args, options) => {
      if (args[0] === 'fetch') order.push(`fetch ${args[1] ?? ''}`)
      return exec(file, args, options)
    }
    await fetchAll(spy, '/repo', { onRemote: (remote) => { order.push(`remote ${remote}`) } })
    expect(order).toEqual(['remote origin', 'fetch origin', 'remote fork', 'fetch fork'])
    expect(calls.slice(2).map(call => call.args)).toEqual([
      ['fetch', 'origin', '--prune', '--progress'],
      ['fetch', 'fork', '--prune', '--progress'],
    ])
  })

  it('leaves out the remotes marked skipFetchAll, as `fetch --all` does', async () => {
    const { exec, calls } = recording([...listing(['origin', 'mirror', 'fork'], 'remote.mirror.skipfetchall true\nremote.fork.skipfetchall false\n'), {}, {}])
    await fetchAll(exec, '/repo', {})
    expect(calls.slice(2).map(call => call.args[1])).toEqual(['origin', 'fork'])
    // The skip flags are read as git booleans, whatever spelling the config used.
    expect(calls[1]?.args).toEqual(['config', '--bool', '--get-regexp', '^remote\\..+\\.skipfetchall$'])
  })

  it('has nothing to do for a repository without remotes', async () => {
    const { exec, calls } = recording([...listing([])])
    await fetchAll(exec, '/repo', {})
    expect(calls).toHaveLength(2)
  })

  it('keeps going after a failing remote and reports every failure under the --all command', async () => {
    const { exec, calls } = recording([
      ...listing(['origin', 'fork', 'backup']),
      { code: 128, stderr: 'Receiving objects:  10% (1/10)\rfatal: early EOF\n' },
      {},
      { code: 1, stderr: "fatal: 'backup' does not appear to be a git repository\n" },
    ])
    const failure = await fetchAll(exec, '/repo', {}).then(() => undefined, (error: unknown) => error)
    expect(calls).toHaveLength(5)
    expect(failure).toBeInstanceOf(GitError)
    expect((failure as GitError).code).toBe(128)
    expect((failure as GitError).message).toBe("git fetch --all --prune failed (exit 128): fatal: early EOF\nfatal: 'backup' does not appear to be a git repository")
  })

  it('stops at once when cancelled, without starting the remotes still waiting', async () => {
    const { exec, calls } = recording([...listing(['origin', 'fork']), { code: 1, cancelled: true }])
    await expect(fetchAll(exec, '/repo', {})).rejects.toBeInstanceOf(CancelledError)
    expect(calls).toHaveLength(3)
  })

  it('stays a plain buffered call (no progress flag, no live options) without a live run', async () => {
    const { exec, calls } = recording([{}])
    await fetchAll(exec, '/repo')
    expect(calls[0]?.args).toEqual(['fetch', '--all', '--prune'])
    expect(calls[0]?.options).toEqual({ cwd: '/repo' })
  })

  it('throws CancelledError for a cancelled run, not a git failure', async () => {
    const { exec } = recording([...listing(['origin']), { code: 1, cancelled: true }])
    await expect(fetchAll(exec, '/repo', {})).rejects.toBeInstanceOf(CancelledError)
  })

  it('fails with the command the user knows and git’s words, without the progress redraws', async () => {
    const stderr = 'Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\rfatal: early EOF\n'
    const { exec } = recording([...listing(['origin']), { code: 128, stderr }])
    const failure = await fetchAll(exec, '/repo', {}).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(GitError)
    expect((failure as GitError).message).toBe('git fetch --all --prune failed (exit 128): fatal: early EOF')
  })
})

describe('updateBranch with a live run', () => {
  it('announces the merge step after the fetch and before the fast-forward', async () => {
    const { exec, calls } = recording([
      ...listing(['origin']),
      {}, // fetch
      { stdout: 'aaa\n' }, // rev-parse before
      {}, // merge
      { stdout: 'bbb\n' }, // rev-parse after
      { stdout: 'main\n' }, // branch --show-current
    ])
    const order: string[] = []
    const spy: Exec = async (file, args, options) => {
      order.push(args[0] ?? '')
      return exec(file, args, options)
    }
    const live: LiveRun = { onMerge: () => { order.push('merge-event') } }
    const outcome = await updateBranch(spy, '/repo', live)
    expect(outcome).toEqual({ branch: 'main', updated: true })
    expect(order.slice(2, 5)).toEqual(['fetch', 'merge-event', 'rev-parse'])
    expect(calls[2]?.args).toContain('--progress')
  })

  it('does not move the branch when the run was cancelled after the fetch finished', async () => {
    const controller = new AbortController()
    const { exec, calls } = recording([...listing(['origin']), {}])
    const aborting: Exec = async (file, args, options) => {
      const result = await exec(file, args, options)
      if (args[0] === 'fetch') controller.abort()
      return result
    }
    await expect(updateBranch(aborting, '/repo', { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError)
    expect(calls).toHaveLength(3)
  })

  it('propagates a cancelled fetch without touching the branch', async () => {
    const { exec, calls } = recording([...listing(['origin']), { code: 1, cancelled: true }])
    await expect(updateBranch(exec, '/repo', {})).rejects.toBeInstanceOf(CancelledError)
    expect(calls).toHaveLength(3)
  })
})

describe('fetchAll live against real git', () => {
  const cleanup: string[] = []
  afterEach(async () => {
    for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('streams git’s own progress output and brings the new commits in', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-live-fetch-'))
    cleanup.push(directory)
    const exec: Exec = (file, args, options) => childProcessExec(file, ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(directory, 'no-hooks')}`, ...args], options)
    const git = async (cwd: string, args: string[]): Promise<string> => {
      const result = await exec('git', args, { cwd })
      if (result.code !== 0) throw new Error(result.stderr)
      return result.stdout.trim()
    }
    const remote = join(directory, 'remote.git')
    const local = join(directory, 'local')
    const peer = join(directory, 'peer')
    await git(directory, ['init', '--bare', '-b', 'main', remote])
    await git(directory, ['clone', remote, local])
    await git(local, ['config', 'user.name', 'Test'])
    await git(local, ['config', 'user.email', 'test@example.invalid'])
    await git(local, ['commit', '--allow-empty', '-m', 'initial'])
    await git(local, ['push', '-u', 'origin', 'HEAD:main'])
    await git(directory, ['clone', remote, peer])
    await git(peer, ['config', 'user.name', 'Peer'])
    await git(peer, ['config', 'user.email', 'peer@example.invalid'])
    // A second remote: where `fetch --all` hides every counter from the user.
    // It forks before the teammate's commit exists, and gets a commit of its
    // own, so each remote has objects the other does not (otherwise whichever
    // is fetched second would find everything already local and transfer nothing).
    const fork = join(directory, 'fork.git')
    await git(directory, ['clone', '--bare', remote, fork])
    await git(local, ['remote', 'add', 'fork', fork])
    await git(peer, ['commit', '--allow-empty', '-m', 'teammate'])
    await git(peer, ['push', 'origin', 'HEAD:main'])
    await git(peer, ['checkout', '-b', 'topic', 'HEAD~1'])
    await git(peer, ['commit', '--allow-empty', '-m', 'fork only'])
    await git(peer, ['push', fork, 'HEAD:refs/heads/topic'])

    // git itself prints no `Fetching <remote>` here: the caller names them,
    // so each remote's output can be told apart.
    const output = new Map<string, string>()
    let current = ''
    await fetchAll(exec, local, {
      onRemote: (name) => { current = name },
      onOutput: (chunk) => { output.set(current, (output.get(current) ?? '') + chunk) },
    })
    expect([...output.keys()].sort()).toEqual(['fork', 'origin'])
    // What does stream is each transfer's own counters and ref update line.
    expect(output.get('origin')).toContain('Counting objects: 100%')
    expect(output.get('origin')).toContain('-> origin/main')
    expect(output.get('fork')).toContain('Counting objects: 100%')
    expect(output.get('fork')).toContain('-> fork/topic')
    expect(await git(local, ['rev-parse', 'origin/main'])).toBe(await git(peer, ['rev-parse', 'origin/main']))
    expect(await git(local, ['rev-parse', 'fork/topic'])).toBe(await git(peer, ['rev-parse', 'HEAD']))

    const outcome = await updateBranch(exec, local, { onOutput: () => undefined })
    expect(outcome).toEqual({ branch: 'main', updated: true })
    expect(await git(local, ['log', '-1', '--format=%s'])).toBe('teammate')
  }, 30_000)
})
