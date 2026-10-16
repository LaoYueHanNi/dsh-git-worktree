import { describe, expect, it, vi } from 'vitest'
import { openPush, planPush, previewPush, pushBranch } from '../src/push.ts'
import { CancelledError, type Exec, type ExecOptions, type ExecResult } from '../src/git.ts'
import { handlePush, handlePushPlan, handlePushPreview, type RouteDeps, type RouteLive } from '../src/routes.ts'
import type { SyncEvent } from '../src/wire.ts'

const SOURCE = 'a'.repeat(40)

/**
 * A scripted git. Plans read the branch (`for-each-ref refs/heads/<name>`),
 * the remote list and ONE `config --get-regexp` for the push-remote keys;
 * a tracking-ref lookup (`for-each-ref ... refs/remotes/...`) and `log`
 * answer from `tracking` / `log`.
 */
function repo(options: { upstream?: string; upstreamRemote?: string; target?: string; track?: string; remotes?: string; pushRemote?: string; pushDefault?: string; reject?: boolean; tracking?: string; log?: string } = {}) {
  const exec = vi.fn<Exec>(async (_file, inputArgs) => {
    const args = inputArgs[0] === '-c' ? inputArgs.slice(2) : inputArgs
    let stdout = ''
    let code = 0
    let stderr = ''
    if (args[0] === 'for-each-ref' && args.some(arg => arg.startsWith('refs/remotes/'))) stdout = options.tracking ?? ''
    else if (args[0] === 'for-each-ref') stdout = ['refs/heads/feature/x', SOURCE, options.upstream ?? '', options.upstreamRemote ?? '', options.target ?? '', options.track ?? ''].join('\t')
    else if (args[0] === 'remote') stdout = options.remotes ?? 'origin\nupstream\n'
    else if (args[0] === 'config') {
      // git prints the section and variable lowercased, the branch as written.
      stdout = [options.pushDefault === undefined ? '' : `remote.pushdefault ${options.pushDefault}`,
        options.pushRemote === undefined ? '' : `branch.feature/x.pushremote ${options.pushRemote}`].filter(Boolean).join('\n')
      if (stdout === '') code = 1
    } else if (args[0] === 'log') stdout = options.log ?? ''
    else if (args[0] === 'push' && options.reject) { code = 1; stderr = 'Permission denied (publickey)'; stdout = '! refs/heads/feature/x [rejected] non-fast-forward' }
    else if (args[0] !== 'check-ref-format' && args[0] !== 'push') throw new Error(`Unexpected git call: ${args.join(' ')}`)
    return { code, stdout, stderr }
  })
  return exec
}

const tracked = { upstream: 'origin/feature/x', upstreamRemote: 'origin', target: 'refs/heads/feature/x' }

describe('push planning', () => {
  it('suggests origin and the full local branch name for first publication', async () => {
    expect(await planPush(repo(), '/repo', 'feature/x')).toEqual({ branch: 'feature/x', remotes: ['origin', 'upstream'], remote: 'origin', target: 'feature/x', confirm: true })
  })
  it('requires no confirmation for the existing same-name upstream', async () => {
    expect(await planPush(repo(tracked), '/repo', 'feature/x')).toMatchObject({ confirm: false, remote: 'origin' })
  })
  it('does not suggest the inherited base branch as the publish target', async () => {
    expect(await planPush(repo({ upstream: 'origin/main', upstreamRemote: 'origin', target: 'refs/heads/main' }), '/repo', 'feature/x'))
      .toMatchObject({ confirm: true, target: 'feature/x', upstream: 'origin/main' })
  })
  it('requires confirmation for gone upstreams and alternate push remotes', async () => {
    expect((await planPush(repo({ ...tracked, track: '[gone]' }), '/repo', 'feature/x')).confirm).toBe(true)
    expect(await planPush(repo({ ...tracked, pushDefault: 'upstream' }), '/repo', 'feature/x')).toMatchObject({ confirm: true, remote: 'upstream' })
    expect((await planPush(repo({ ...tracked, pushRemote: 'origin', pushDefault: 'upstream' }), '/repo', 'feature/x')).confirm).toBe(false)
  })
  it('reports missing remotes and invalid configured push remotes', async () => {
    await expect(planPush(repo({ remotes: '' }), '/repo', 'feature/x')).rejects.toThrow('No Git remote')
    await expect(planPush(repo({ pushRemote: 'missing' }), '/repo', 'feature/x')).rejects.toThrow('not configured')
  })
  it('matches an exact full local ref rather than prefix descendants', async () => {
    await expect(planPush(repo(), '/repo', 'feature')).rejects.toThrow('no longer exists')
  })
  it('gathers the plan with three reads, one of them covering both push-remote keys', async () => {
    const exec = repo({ ...tracked, pushDefault: 'upstream', pushRemote: 'origin' })
    await planPush(exec, '/repo', 'feature/x')
    expect(exec.mock.calls.map(call => call[1][0]).sort()).toEqual(['config', 'for-each-ref', 'remote'])
    expect(exec.mock.calls.find(call => call[1][0] === 'config')?.[1]).toEqual(['config', '--get-regexp', '^(remote\\.pushdefault|branch\\..*\\.pushremote)$'])
  })
  it("ignores another branch's push remote and lets the last duplicate entry win", async () => {
    const exec = repo(tracked)
    const base = exec.getMockImplementation()!
    exec.mockImplementation(async (file, args, options) => args[0] === 'config'
      ? { code: 0, stdout: 'remote.pushdefault upstream\nbranch.other.pushremote origin\nremote.pushdefault origin\nbranch.feature/x.pushremote upstream\n', stderr: '' }
      : base(file, args, options))
    expect(await planPush(exec, '/repo', 'feature/x')).toMatchObject({ remote: 'upstream', confirm: true })
  })
  it('reports a failing config read instead of treating it as "nothing configured"', async () => {
    const exec = repo(tracked)
    const base = exec.getMockImplementation()!
    exec.mockImplementation(async (file, args, options) => args[0] === 'config'
      ? { code: 128, stdout: '', stderr: 'fatal: bad config line 3' }
      : base(file, args, options))
    await expect(planPush(exec, '/repo', 'feature/x')).rejects.toThrow('bad config line 3')
  })
})

const TARGET = 'b'.repeat(40)
const tip = { tracking: `refs/remotes/origin/feature/x\t${TARGET}`, log: `${'c'.repeat(40)}\tone` }

describe('opening the push window', () => {
  it('bundles a display-only local snapshot with the plan, reading only local refs', async () => {
    const exec = repo({ ...tracked, ...tip })
    expect(await openPush(exec, '/repo', 'feature/x')).toEqual({
      branch: 'feature/x', remotes: ['origin', 'upstream'], remote: 'origin', target: 'feature/x', confirm: false, upstream: 'origin/feature/x',
      local: { sourceOid: SOURCE, targetOid: TARGET, commits: [{ oid: 'c'.repeat(40), subject: 'one' }], total: 1, truncated: false },
    })
    expect(exec.mock.calls.some(call => ['ls-remote', 'fetch', 'push', 'rev-list', 'rev-parse'].includes(call[1][0]!))).toBe(false)
  })
  it('counts a never-published branch against what the remote already has', async () => {
    const exec = repo({ log: tip.log })
    const plan = await openPush(exec, '/repo', 'feature/x')
    expect(plan.local).toMatchObject({ sourceOid: SOURCE, targetOid: null, total: 1 })
    expect(exec.mock.calls.find(call => call[1][0] === 'log')?.[1]).toEqual(expect.arrayContaining([SOURCE, '--not', '--remotes=origin']))
  })
  it('keeps the plan when the snapshot cannot be built, but not when planning fails', async () => {
    const exec = repo(tracked)
    const base = exec.getMockImplementation()!
    exec.mockImplementation(async (file, args, options) => args[0] === 'log'
      ? { code: 128, stdout: '', stderr: 'bad object' }
      : base(file, args, options))
    const plan = await openPush(exec, '/repo', 'feature/x')
    expect(plan).toMatchObject({ confirm: false, remote: 'origin' })
    expect(plan.local).toBeUndefined()
    await expect(openPush(repo({ remotes: '' }), '/repo', 'feature/x')).rejects.toThrow('No Git remote')
  })
  it('is what the planning route answers with', async () => {
    const outcome = await handlePushPlan({ exec: repo({ ...tracked, ...tip }) } as RouteDeps, { repoPath: '/repo', branch: 'feature/x' })
    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({ remote: 'origin', local: { total: 1, targetOid: TARGET } })
  })
})

describe('explicit branch push', () => {
  it('cannot publish an untracked branch without destination confirmation', async () => {
    const exec = repo()
    await expect(pushBranch(exec, '/repo', { repoPath: '/repo', branch: 'feature/x' })).rejects.toThrow('confirmation')
    expect(exec.mock.calls.some(call => call[1].includes('push'))).toBe(false)
  })
  it('pushes one exact branch independently of HEAD, without setting upstream again', async () => {
    const exec = repo(tracked)
    await pushBranch(exec, '/another-worktree', { repoPath: '/another-worktree', branch: 'feature/x' })
    const call = exec.mock.calls.find(call => call[1].includes('push'))!
    expect(call[1]).toEqual(['-c', 'remote.origin.mirror=false', 'push', '--porcelain', '--no-force', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no', '--', 'origin', 'refs/heads/feature/x:refs/heads/feature/x'])
    expect(call[2]).toEqual({ cwd: '/another-worktree', timeoutMs: 120_000, nonInteractive: true })
  })
  it('sets upstream to the explicitly confirmed remote and branch', async () => {
    const exec = repo()
    await pushBranch(exec, '/repo', { repoPath: '/repo', branch: 'feature/x', remote: 'upstream', target: 'review/x' })
    expect(exec.mock.calls.at(-1)?.[1]).toContain('--set-upstream')
    expect(exec.mock.calls.at(-1)?.[1].at(-1)).toBe('refs/heads/feature/x:refs/heads/review/x')
    await expect(pushBranch(exec, '/repo', { repoPath: '/repo', branch: 'feature/x', remote: 'arbitrary-url', target: 'x' })).rejects.toThrow('not configured')
  })
  describe('--set-upstream', () => {
    const flagged = async (options: Parameters<typeof repo>[0], remote: string, target: string) => {
      const exec = repo(options)
      await pushBranch(exec, '/repo', { repoPath: '/repo', branch: 'feature/x', remote, target })
      return exec.mock.calls.find(call => call[1].includes('push'))![1].includes('--set-upstream')
    }
    it('adopts the destination when the branch has no upstream or its upstream vanished', async () => {
      expect(await flagged({}, 'origin', 'feature/x')).toBe(true)
      expect(await flagged({ ...tracked, track: '[gone]' }, 'origin', 'feature/x')).toBe(true)
    })
    it('replaces an upstream inherited from the base branch', async () => {
      expect(await flagged({ upstream: 'origin/main', upstreamRemote: 'origin', target: 'refs/heads/main' }, 'origin', 'feature/x')).toBe(true)
    })
    it('keeps a same-named counterpart, whichever remote or name this push goes to', async () => {
      // Fork workflow: tracking origin/feature/x, pushing to a personal remote.
      expect(await flagged({ ...tracked, pushDefault: 'upstream' }, 'upstream', 'feature/x')).toBe(false)
      // One-off push under another name.
      expect(await flagged(tracked, 'origin', 'review/x')).toBe(false)
      expect(await flagged(tracked, 'origin', 'feature/x')).toBe(false)
    })
  })
  it('returns rejection and authentication details from both output streams', async () => {
    const exec = repo({ ...tracked, reject: true })
    await expect(pushBranch(exec, '/repo', { repoPath: '/repo', branch: 'feature/x' })).rejects.toThrow('Permission denied')
    await expect(pushBranch(exec, '/repo', { repoPath: '/repo', branch: 'feature/x' })).rejects.toThrow('non-fast-forward')
  })
})

describe('live branch push', () => {
  const body = { repoPath: '/repo', branch: 'feature/x' }
  /** A tracked branch whose `git push` is answered by `answer`, every other git call by the usual script. */
  const liveRepo = (answer: (options: ExecOptions) => Partial<ExecResult>) => {
    const base = repo(tracked)
    return vi.fn<Exec>(async (file, args, options) => args.includes('push')
      ? { code: 0, stdout: '', stderr: '', ...answer(options) }
      : base(file, args, options))
  }
  const pushCall = (exec: ReturnType<typeof liveRepo>) => exec.mock.calls.find(call => call[1].includes('push'))!

  it('asks git for progress, lifts the two-minute cap and hands over the output sink and the signal', async () => {
    const exec = liveRepo(() => ({}))
    const controller = new AbortController()
    const onOutput = (): void => undefined
    await pushBranch(exec, '/repo', body, { onOutput, signal: controller.signal })
    const call = pushCall(exec)
    expect(call[1]).toEqual(['-c', 'remote.origin.mirror=false', 'push', '--porcelain', '--no-force', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no', '--progress', '--', 'origin', 'refs/heads/feature/x:refs/heads/feature/x'])
    expect(call[2]).toMatchObject({ cwd: '/repo', nonInteractive: true, onOutput, signal: controller.signal })
    // A big upload has no honest upper bound; silence is what is limited.
    expect(call[2].timeoutMs).toBeUndefined()
    expect(call[2].idleTimeoutMs).toBeGreaterThan(60_000)
  })

  it('throws CancelledError for a stopped push, not a git failure', async () => {
    const exec = liveRepo(() => ({ code: 1, cancelled: true }))
    await expect(pushBranch(exec, '/repo', body, {})).rejects.toBeInstanceOf(CancelledError)
  })

  it('fails with git’s own words and the porcelain lines, without the progress redraws', async () => {
    const exec = liveRepo(() => ({
      code: 1,
      stderr: 'Writing objects:  10% (1/10)\rWriting objects:  50% (5/10)\rremote: Permission denied\n',
      stdout: '!\trefs/heads/feature/x:refs/heads/feature/x\t[remote rejected]\n',
    }))
    const failure = await pushBranch(exec, '/repo', body, {}).then(() => undefined, (error: unknown) => error as Error)
    expect(failure?.message).toContain('remote: Permission denied')
    expect(failure?.message).toContain('[remote rejected]')
    expect(failure?.message).not.toContain('Writing objects')
  })

  describe('through the route', () => {
    const request = { ...body, remote: 'origin', target: 'feature/x' }
    it('streams git’s progress as structured events, ignoring the porcelain lines, then answers as the plain request does', async () => {
      const exec = liveRepo((options) => {
        options.onOutput?.('Writing objects:  50% (1')
        options.onOutput?.('/2), 512.00 KiB | 1.00 MiB/s\r')
        // A branch named like a percentage must not be mistaken for a counter.
        options.onOutput?.('*\trefs/heads/feature/x:refs/heads/feature/50%-done\t[new branch]\n')
        return {}
      })
      const events: SyncEvent[] = []
      const live: RouteLive = { signal: new AbortController().signal, emit: event => events.push(event) }
      const outcome = await handlePush({ exec } as RouteDeps, request, live)
      expect(outcome).toEqual({ status: 200, body: { branch: 'feature/x', remote: 'origin', target: 'feature/x' } })
      expect(events).toEqual([{ type: 'progress', text: 'Writing objects:  50% (1/2), 512.00 KiB | 1.00 MiB/s', percent: 50 }])
    })

    it('answers 499 when the push was cancelled, and 400 with git’s reason when it failed', async () => {
      const live: RouteLive = { signal: new AbortController().signal, emit: () => undefined }
      expect(await handlePush({ exec: liveRepo(() => ({ code: 1, cancelled: true })) } as RouteDeps, request, live))
        .toEqual({ status: 499, body: { error: 'Cancelled' } })
      const rejected = await handlePush({ exec: liveRepo(() => ({ code: 1, stderr: 'Writing objects: 100% (2/2), done.\r! [rejected] (fetch first)\n' })) } as RouteDeps, request, live)
      expect(rejected.status).toBe(400)
      if (!('error' in rejected.body)) throw new Error('expected an error body')
      expect(rejected.body.error).toContain('[rejected] (fetch first)')
      expect(rejected.body.error).not.toContain('Writing objects')
    })

    it('keeps validating before it touches git, live or not', async () => {
      const exec = liveRepo(() => ({}))
      const live: RouteLive = { signal: new AbortController().signal, emit: () => undefined }
      expect((await handlePush({ exec } as RouteDeps, { repoPath: 'relative', branch: 'x' }, live)).status).toBe(400)
      expect(exec).not.toHaveBeenCalled()
    })
  })
})

describe('push routes', () => {
  const deps = { exec: repo() } as RouteDeps
  it('validates body, absolute paths, and destination pairs before executing git', async () => {
    for (const body of [null, {}, { repoPath: 'relative', branch: 'x' }, { repoPath: '/repo', branch: '' },
      { repoPath: '/repo', branch: 'feature/x', remote: 'origin' }, { repoPath: '/repo', branch: 'feature/x', remote: 1, target: 'x' }]) {
      expect((await handlePush(deps, body)).status).toBe(400)
    }
    expect(deps.exec).not.toHaveBeenCalled()
  })
  it('previews without pushing and returns a useful rejection on a stale destination', async () => {
    expect((await handlePushPlan(deps, { repoPath: '/repo', branch: 'feature/x' })).status).toBe(200)
    expect((await handlePush(deps, { repoPath: '/repo', branch: 'feature/x' })).status).toBe(400)
  })
  it('accepts an explicit destination on publication and forwards both fields', async () => {
    const exec = repo()
    expect(await handlePush({ exec } as RouteDeps, { repoPath: '/repo', branch: 'feature/x', remote: 'upstream', target: 'review/x' }))
      .toEqual({ status: 200, body: { branch: 'feature/x', remote: 'upstream', target: 'review/x' } })
    expect(exec.mock.calls.at(-1)?.[1]).toContain('--set-upstream')
    expect(exec.mock.calls.at(-1)?.[1].slice(-2)).toEqual(['upstream', 'refs/heads/feature/x:refs/heads/review/x'])
  })
  it('rejects destination fields on the read-only planning route', async () => {
    const exec = repo()
    expect((await handlePushPlan({ exec } as RouteDeps, { repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'x' })).status).toBe(400)
    expect(exec).not.toHaveBeenCalled()
  })
  it('validates tag modes, boolean force, source IDs and preview fields before executing git', async () => {
    const exec = repo()
    const base = { repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'x' }
    for (const extras of [{ tags: 'bad' }, { tags: true }, { force: 'yes' }, { sourceOid: 'short' }, { expectedTarget: 3 }]) {
      expect((await handlePush({ exec } as RouteDeps, { ...base, ...extras })).status).toBe(400)
    }
    expect((await handlePushPreview({ exec } as RouteDeps, { ...base, force: true })).status).toBe(400)
    expect((await handlePushPreview({ exec } as RouteDeps, { ...base, remote: '' })).status).toBe(400)
    expect((await handlePushPreview({ exec } as RouteDeps, { ...base, localOnly: 'yes' })).status).toBe(400)
    expect((await handlePush({ exec } as RouteDeps, { ...base, localOnly: true })).status).toBe(400)
    expect(exec).not.toHaveBeenCalled()
  })
  it('refuses force without a previewed source and target lease', async () => {
    const exec = repo()
    const outcome = await handlePush({ exec } as RouteDeps, { repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'x', force: true })
    expect(outcome.status).toBe(400)
    expect(exec.mock.calls.some(call => call[1].includes('push'))).toBe(false)
  })
})

describe('bounded push preview', () => {
  it('returns the actual count with a bounded first-line list and never pushes', async () => {
    const exec = repo()
    const base = exec.getMockImplementation()!
    exec.mockImplementation(async (file, args, options) => {
      const result = (stdout: string) => ({ code: 0, stdout, stderr: '' })
      if (args[0] === 'remote' && args[1] === 'get-url') return result('/configured-push.git')
      if (args[0] === 'rev-parse') return result('a'.repeat(40))
      if (args[0] === 'ls-remote') return result('')
      if (args[0] === 'rev-list') return result('300')
      if (args[0] === 'log') return result(Array.from({ length: 201 }, (_, index) =>
        `${index.toString(16).padStart(40, '0')}\tsubject ${index}`).join('\n'))
      return base(file, args, options)
    })
    const preview = await previewPush(exec, '/repo', { repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'new' })
    expect(preview).toMatchObject({ targetOid: null, total: 300, truncated: true })
    expect(preview.commits).toHaveLength(200)
    expect(preview.commits[0]).toEqual({ subject: 'subject 0', oid: '0'.repeat(40) })
    expect(preview.commits.at(-1)?.subject).toBe('subject 199')
    expect(exec.mock.calls.find(call => call[1][0] === 'log')?.[1]).toContain('201')
    expect(exec.mock.calls.find(call => call[1][0] === 'ls-remote')?.[1]).toContain('/configured-push.git')
    expect(exec.mock.calls.find(call => call[1][0] === 'ls-remote')?.[2]).toMatchObject({ timeoutMs: 20_000, nonInteractive: true })
    expect(exec.mock.calls.some(call => call[1].includes('push'))).toBe(false)
  })

  describe('git work per preview', () => {
    const kind = (call: readonly [string, readonly string[], unknown?]) => call[1][0] === 'remote' && call[1][1] === 'get-url' ? 'remote get-url' : call[1][0]!
    const script = (overrides: Record<string, (args: readonly string[]) => { code: number; stdout: string; stderr: string }> = {}) => {
      const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
      return vi.fn<Exec>(async (_file, args) => (overrides[args[0]!] ?? ((): ReturnType<typeof ok> => {
        switch (args[0]) {
          case 'rev-parse': return ok(SOURCE)
          case 'remote': return ok(args[1] === 'get-url' ? '/push.git' : 'origin\n')
          case 'ls-remote': return ok(`${TARGET}\trefs/heads/x`)
          case 'for-each-ref': return ok(`refs/remotes/origin/x\t${TARGET}`)
          case 'log': return ok(`${'c'.repeat(40)}\tone`)
          default: return ok()
        }
      }))(args))
    }
    const body = { repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'x' }

    it('needs no remote listing, probe or recount to verify a destination', async () => {
      const exec = script()
      await previewPush(exec, '/repo', body)
      expect(exec.mock.calls.map(kind).sort()).toEqual(['check-ref-format', 'log', 'ls-remote', 'remote get-url', 'rev-parse'])
    })
    it('reads a local snapshot with five calls, checking the remote name against one listing', async () => {
      const exec = script()
      await previewPush(exec, '/repo', { ...body, localOnly: true })
      expect(exec.mock.calls.map(kind).sort()).toEqual(['check-ref-format', 'for-each-ref', 'log', 'remote', 'rev-parse'])
      await expect(previewPush(script(), '/repo', { ...body, remote: 'nowhere', localOnly: true })).rejects.toThrow('"nowhere" is not configured')
    })
    it('fetches a missing remote tip and walks again, but surfaces the real failure when the tip is present', async () => {
      let logs = 0
      let probes = 0
      const exec = script({
        log: () => logs++ === 0 ? { code: 128, stdout: '', stderr: 'bad object' } : { code: 0, stdout: `${'c'.repeat(40)}\tone`, stderr: '' },
        'cat-file': () => probes++ === 0 ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' },
      })
      expect(await previewPush(exec, '/repo', body)).toMatchObject({ targetOid: TARGET, total: 1 })
      expect(exec.mock.calls.map(kind).slice(-5)).toEqual(['log', 'cat-file', 'fetch', 'cat-file', 'log'])
      expect(exec.mock.calls.find(call => call[1][0] === 'fetch')?.[1]).toEqual(expect.arrayContaining(['--refmap=', '--no-write-fetch-head', '/push.git', 'refs/heads/x']))

      const present = script({ log: () => ({ code: 128, stdout: '', stderr: 'bad object' }), 'cat-file': () => ({ code: 0, stdout: '', stderr: '' }) })
      await expect(previewPush(present, '/repo', body)).rejects.toThrow('bad object')
      expect(present.mock.calls.some(call => call[1][0] === 'fetch')).toBe(false)
    })
  })

  it.each([0, 2, 200])('uses a complete %i-subject list as its count without recounting history', async count => {
    const exec = repo()
    const base = exec.getMockImplementation()!
    exec.mockImplementation(async (file, args, options) => {
      const result = (stdout: string) => ({ code: 0, stdout, stderr: '' })
      if (args[0] === 'rev-parse') return result('a'.repeat(40))
      if (args[0] === 'for-each-ref') return result('refs/remotes/origin/feature/x\t' + 'b'.repeat(40))
      if (args[0] === 'log') return result(Array.from({ length: count }, (_, index) =>
        `${index.toString(16).padStart(40, '0')}\tsubject ${index}`).join('\n'))
      return base(file, args, options)
    })
    const preview = await previewPush(exec, '/repo', { repoPath: '/repo', branch: 'feature/x', remote: 'origin', target: 'feature/x', localOnly: true })
    expect(preview).toMatchObject({ total: count, truncated: false })
    expect(preview.commits).toHaveLength(count)
    expect(exec.mock.calls.some(call => call[1][0] === 'rev-list')).toBe(false)
    expect(exec.mock.calls.some(call => ['ls-remote', 'fetch', 'push'].includes(call[1][0]!))).toBe(false)
  })
})
