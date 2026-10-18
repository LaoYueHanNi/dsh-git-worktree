import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childProcessExec, type Exec } from '../src/git.ts'
import { readCommit, readHistory } from '../src/history.ts'
import { handleCommit, handleHistory, type RouteDeps } from '../src/routes.ts'

const directories: string[] = []
afterEach(async () => {
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
    expect(exec.mock.calls).toHaveLength(0)
  })
})
