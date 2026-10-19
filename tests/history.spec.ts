import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childProcessExec, type Exec } from '../src/git.ts'
import { invalidateAuthorCache, readAuthors, readCommit, readHistory, resetAuthorCache } from '../src/history.ts'
import { handleAuthors, handleCommit, handleHistory, type RouteDeps } from '../src/routes.ts'

const directories: string[] = []
afterEach(async () => {
  resetAuthorCache()
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-history-'))
  directories.push(cwd)
  const exec: Exec = (file, args, options) => childProcessExec(file,
    ['-c', `core.hooksPath=${join(cwd, 'no-hooks')}`, '-c', 'commit.gpgsign=false', ...args], options)
  const git = async (...args: string[]): Promise<string> => {
    const result = await exec('git', args, { cwd })
    if (result.code !== 0) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  await git('init', '-b', 'main')
  await git('config', 'user.name', '测试作者')
  await git('config', 'user.email', 'history@example.invalid')
  await git('config', 'core.autocrlf', 'false')
  return { cwd, exec, git }
}

describe('read-only commit history with real Git', () => {
  it('reports repository-wide root and parent stats from a subdirectory with diff.relative enabled', async () => {
    const { cwd, exec, git } = await fixture()
    const subdir = join(cwd, 'src')
    await mkdir(subdir)
    await writeFile(join(cwd, 'root.txt'), 'outside\n')
    await writeFile(join(subdir, 'inside.txt'), 'inside\n')
    await git('add', '.')
    await git('commit', '-m', 'root with files inside and outside src')
    await git('config', 'diff.relative', 'true')
    const root = await git('rev-parse', 'HEAD')
    expect(await readCommit(exec, subdir, root)).toMatchObject({ files: 2, firstFile: 'root.txt', added: 2 })
    expect(await readCommit(exec, subdir, root)).toEqual(await readCommit(exec, cwd, root))
    await writeFile(join(cwd, 'root.txt'), 'outside\nanother line\n')
    await git('add', '.')
    await git('commit', '-m', 'only changes outside src')
    const next = await git('rev-parse', 'HEAD')
    expect(await readCommit(exec, subdir, next)).toMatchObject({ files: 1, firstFile: 'root.txt', added: 1, removed: 0 })
    expect(await readCommit(exec, subdir, next)).toEqual(await readCommit(exec, cwd, next))
  }, 30_000)

  it('returns an unborn empty and rejects missing or expression refs', async () => {
    const { cwd, exec, git } = await fixture()
    expect(await readHistory(exec, cwd, 'refs/heads/main')).toEqual({ tip: null, commits: [], next: null })
    await git('commit', '--allow-empty', '-m', 'root')
    await expect(readHistory(exec, cwd, 'refs/heads/missing')).rejects.toThrow()
    await expect(readHistory(exec, cwd, 'refs/heads/main~1')).rejects.toThrow()
    await expect(readHistory(exec, cwd, '--all')).rejects.toThrow()
    await git('checkout', '--detach')
    expect((await readHistory(exec, cwd, 'HEAD')).commits[0]?.subject).toBe('root')
    await git('checkout', '--orphan', 'unborn')
    expect(await readHistory(exec, cwd, 'refs/heads/unborn')).toEqual({ tip: null, commits: [], next: null })
  }, 30_000)

  it('preserves full bodies, Unicode and file stats, and compares merges to their first parent', async () => {
    const { cwd, exec, git } = await fixture()
    await writeFile(join(cwd, '中文.txt'), 'one\ntwo\n')
    await git('add', '.')
    await git('commit', '-m', '初始提交', '-m', '- 第一项\n- 第二项\n\n背景：保留完整正文。')
    const root = await git('rev-parse', 'HEAD')
    expect(await readCommit(exec, cwd, root)).toMatchObject({ subject: '初始提交', author: '测试作者', parents: [],
      body: '- 第一项\n- 第二项\n\n背景：保留完整正文。', files: 1, firstFile: '中文.txt', added: 2, removed: 0 })
    await git('checkout', '-b', 'topic')
    await writeFile(join(cwd, 'binary.dat'), new Uint8Array([0, 1, 2, 3]))
    await git('add', '.')
    await git('commit', '-m', 'binary')
    const topic = await git('rev-parse', 'HEAD')
    expect(await readCommit(exec, cwd, topic)).toMatchObject({ body: '', binaryFiles: 1, files: 1, added: 0, removed: 0 })
    await git('checkout', 'main')
    await git('commit', '--allow-empty', '-m', 'main-only')
    const firstParent = await git('rev-parse', 'HEAD')
    await git('merge', '--no-ff', 'topic', '-m', 'merge topic')
    const merge = await git('rev-parse', 'HEAD')
    const before = await git('status', '--porcelain=v1', '-b')
    const history = await readHistory(exec, cwd, 'refs/heads/main')
    expect(history.commits[0]).toMatchObject({ oid: merge, parents: [firstParent, topic] })
    expect(history.commits.at(-1)?.oid).toBe(root)
    expect(await readCommit(exec, cwd, merge)).toMatchObject({ files: 1, firstFile: 'binary.dat', binaryFiles: 1 })
    const branch = await readHistory(exec, cwd, 'refs/heads/topic')
    expect(branch.commits.map(c => c.oid)).toEqual([topic, root])
    expect(await git('status', '--porcelain=v1', '-b')).toBe(before)
    expect(await git('branch', '--show-current')).toBe('main')
  }, 30_000)
})

describe('bounded history paging and route validation', () => {
  const tip = 'a'.repeat(40)
  it('requests one lookahead row and keeps subsequent pages pinned to the original OID', async () => {
    const exec = vi.fn<Exec>(async (_file, args) => {
      if (args[0] === 'check-ref-format') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'rev-parse') return { code: 0, stdout: tip, stderr: '' }
      const offset = Number(args.find(arg => arg.startsWith('--skip='))?.slice(7))
      const commits = Array.from({ length: offset === 0 ? 101 : 5 }, (_, i) => {
        const oid = (offset + i + 1).toString(16).padStart(40, '0')
        return [oid, '', 'A', '2026-10-18T12:00:00+08:00', `subject ${offset + i}`].join('\0') + '\0'
      }).join('')
      return { code: 0, stdout: commits, stderr: '' }
    })
    const first = await readHistory(exec, '/repo', 'refs/heads/main')
    expect(first.commits).toHaveLength(100)
    expect(first.next).toBe(100)
    const next = await readHistory(exec, '/repo', 'refs/heads/main', first.tip!, first.next!)
    expect(next.commits).toHaveLength(5)
    expect(next.next).toBeNull()
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'rev-parse')).toHaveLength(1)
    expect(exec.mock.calls.at(-1)?.[1]).toContain(tip)
    expect(exec.mock.calls.at(-1)?.[1]).toContain('--max-count=101')
    expect(exec.mock.calls.at(-1)?.[1]).toContain('--skip=100')
  })

  it('rejects malformed bodies, paths, OIDs and offsets before a history walk', async () => {
    const exec = vi.fn<Exec>(async () => ({ code: 0, stdout: '', stderr: '' }))
    const deps = { exec } as RouteDeps
    for (const body of [null, [], {}, { repoPath: 'relative', ref: 'HEAD' }, { repoPath: '/repo', ref: 'HEAD', offset: '-1' },
      { repoPath: '/repo', ref: 'HEAD', offset: '1e3' }, { repoPath: '/repo', ref: 'HEAD', tip: '--all' },
      { repoPath: '/repo', ref: 'HEAD', offset: '1000001' }, { repoPath: '/repo', ref: 'HEAD', unknown: true }]) {
      expect((await handleHistory(deps, body)).status).toBe(400)
    }
    expect((await handleCommit(deps, { repoPath: '/repo', oid: '--all' })).status).toBe(400)
    expect((await handleCommit(deps, { repoPath: '/repo', oid: 1 })).status).toBe(400)
    expect((await handleAuthors(deps, { repoPath: 'relative', ref: 'HEAD' })).status).toBe(400)
    expect((await handleAuthors(deps, { repoPath: '/repo', ref: 'HEAD', tip: '--all' })).status).toBe(400)
    expect(exec.mock.calls).toHaveLength(0)
  })
})

describe('branch author list cache', () => {
  const tip = 'b'.repeat(40)
  const execFor = (log: (args: readonly string[]) => { code: number; stdout: string; stderr: string } | Promise<{ code: number; stdout: string; stderr: string }>): Exec =>
    vi.fn<Exec>(async (_file, args) => {
      if (args[0] === 'check-ref-format') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'log') return log(args)
      return { code: 0, stdout: '', stderr: '' }
    })

  it('returns every distinct author and does not walk again for the same tip', async () => {
    const exec = execFor(() => ({ code: 0, stdout: 'Bob\0Alice\0Bob\0\0', stderr: '' }))
    const first = await readAuthors(exec, '/repo', 'refs/heads/main', tip)
    expect(first).toEqual({ tip, authors: ['Alice', 'Bob'].sort((a, b) => a.localeCompare(b)) })
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'log')).toHaveLength(1)
    expect(exec.mock.calls.find(([, args]) => args[0] === 'log')?.[1]).toContain('--format=%an')
    expect(exec.mock.calls.find(([, args]) => args[0] === 'log')?.[1].some(arg => arg.startsWith('--max-count'))).toBe(false)
    await expect(readAuthors(exec, '/repo', 'refs/heads/main', tip)).resolves.toEqual(first)
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'log')).toHaveLength(1)
    await expect(readAuthors(exec, '/repo', 'refs/heads/main', tip, true)).resolves.toEqual(first)
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'log')).toHaveLength(2)
  })

  it('does not keep a walk that finished after the repository cache was dropped', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let started: (() => void) | undefined
    const ready = new Promise<void>(resolve => { started = resolve })
    const exec = execFor(async () => {
      started?.()
      await gate
      return { code: 0, stdout: 'Ada\0', stderr: '' }
    })
    const pending = readAuthors(exec, '/repo', 'refs/heads/main', tip)
    await ready
    invalidateAuthorCache('/repo')
    release?.()
    await pending
    const logs = (): number => exec.mock.calls.filter(([, args]) => args[0] === 'log').length
    expect(logs()).toBe(1)
    await readAuthors(exec, '/repo', 'refs/heads/main', tip)
    expect(logs()).toBe(2)
  })

  it('shares one in-flight walk and does not cache a failed walk', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let fail = true
    const exec = execFor(async () => {
      if (fail) return { code: 128, stdout: '', stderr: 'boom' }
      await gate
      return { code: 0, stdout: 'Ada\0Ada\0', stderr: '' }
    })
    await expect(readAuthors(exec, '/repo', 'refs/heads/main', tip)).rejects.toThrow(/boom/)
    fail = false
    const pending = Promise.all([
      readAuthors(exec, '/repo', 'refs/heads/main', tip),
      readAuthors(exec, '/repo', 'refs/heads/main', tip),
    ])
    release?.()
    const [left, right] = await pending
    expect(left.authors).toEqual(['Ada'])
    expect(right).toEqual(left)
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'log')).toHaveLength(2)
  })

  it('forgets the oldest tip after 32 repository histories', async () => {
    const exec = execFor(args => ({ code: 0, stdout: `Who ${args.at(-2) ?? ''}\0`, stderr: '' }))
    const tips = Array.from({ length: 33 }, (_, index) => index.toString(16).padStart(40, 'a'))
    for (const item of tips) await readAuthors(exec, '/repo', 'refs/heads/main', item)
    const logs = (): number => exec.mock.calls.filter(([, args]) => args[0] === 'log').length
    const before = logs()
    await readAuthors(exec, '/repo', 'refs/heads/main', tips[32]!)
    expect(logs()).toBe(before)
    await readAuthors(exec, '/repo', 'refs/heads/main', tips[0]!)
    expect(logs()).toBe(before + 1)
  })

  it('lists both committers of a real branch once, including an unborn empty', async () => {
    const { cwd, exec, git } = await fixture()
    expect(await readAuthors(exec, cwd, 'refs/heads/main')).toEqual({ tip: null, authors: [] })
    await git('commit', '--allow-empty', '-m', 'first')
    await git('config', 'user.name', '另一位')
    await git('commit', '--allow-empty', '-m', 'second')
    await git('commit', '--allow-empty', '-m', 'third by the same person')
    let walks = 0
    const counting: Exec = (file, args, options) => {
      if (args[0] === 'log') walks += 1
      return exec(file, args, options)
    }
    const listed = await readAuthors(counting, cwd, 'refs/heads/main')
    expect(listed.tip).toMatch(/^[a-f0-9]{40}$/)
    expect(new Set(listed.authors)).toEqual(new Set(['测试作者', '另一位']))
    expect(listed.authors).toEqual([...listed.authors].sort((a, b) => a.localeCompare(b)))
    expect(walks).toBe(1)
    expect(await readAuthors(counting, cwd, 'refs/heads/main', listed.tip!)).toEqual(listed)
    expect(walks).toBe(1)
    const route = await handleAuthors({ exec: counting } as RouteDeps, { repoPath: cwd, ref: 'refs/heads/main', tip: listed.tip })
    expect(route).toEqual({ status: 200, body: listed })
    expect(walks).toBe(1)
  }, 30_000)
})
