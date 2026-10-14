import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCheckedOutBranch } from '../src/head.ts'
import { handleHead } from '../src/routes.ts'

/** Best-effort cleanup list (Windows file locks must not fail the suite). */
const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop()
    if (dir === undefined) continue
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ })
  }
})

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-head-'))
  cleanup.push(dir)
  return dir
}

async function mainRepo(head: string): Promise<string> {
  const root = await temp()
  const repo = join(root, 'repo')
  await mkdir(join(repo, '.git'), { recursive: true })
  await writeFile(join(repo, '.git', 'HEAD'), head)
  return repo
}

describe('readCheckedOutBranch', () => {
  it('reads a branch from a parent directory', async () => {
    const repo = await mainRepo('ref: refs/heads/main\n')
    await mkdir(join(repo, 'a', 'b'), { recursive: true })
    expect(await readCheckedOutBranch(join(repo, 'a', 'b'))).toEqual({ kind: 'branch', name: 'main' })
  })

  it('keeps a slash and non-ascii name, and accepts CRLF', async () => {
    const repo = await mainRepo('ref: refs/heads/feat/功能\r\n')
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'branch', name: 'feat/功能' })
  })

  it('reports HEAD when detached', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const repo = await mainRepo(`${sha}\n`)
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'branch', name: 'HEAD' })
    const sha256 = 'a'.repeat(64)
    await writeFile(join(repo, '.git', 'HEAD'), `${sha256}\n`)
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'branch', name: 'HEAD' })
  })

  it('reports HEAD for a symbolic ref that is not a branch', async () => {
    const repo = await mainRepo('ref: refs/remotes/origin/main\n')
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'branch', name: 'HEAD' })
  })

  it('follows a linked worktree gitfile, relative and absolute', async () => {
    const root = await temp()
    const gitDir = join(root, 'repo', '.git', 'worktrees', 'feat-x')
    await mkdir(gitDir, { recursive: true })
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/feat/x\n')
    const wt = join(root, 'wt')
    await mkdir(join(wt, 'src'), { recursive: true })
    await writeFile(join(wt, '.git'), 'gitdir: ../repo/.git/worktrees/feat-x\n')
    expect(await readCheckedOutBranch(join(wt, 'src'))).toEqual({ kind: 'branch', name: 'feat/x' })
    await writeFile(join(wt, '.git'), `gitdir: ${gitDir}\n`)
    expect(await readCheckedOutBranch(wt)).toEqual({ kind: 'branch', name: 'feat/x' })
  })

  it('does not walk past a broken gitfile to a parent repository', async () => {
    const repo = await mainRepo('ref: refs/heads/main\n')
    const nested = join(repo, 'nested')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, '.git'), 'not a gitfile\n')
    expect(await readCheckedOutBranch(nested)).toEqual({ kind: 'unread' })
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'branch', name: 'main' })
  })

  it('skips a partial, empty, or oversized HEAD', async () => {
    const repo = await mainRepo('ref: refs/hea')
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'unread' })
    await writeFile(join(repo, '.git', 'HEAD'), '')
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'unread' })
    await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/foo bar\n')
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'unread' })
    await writeFile(join(repo, '.git', 'HEAD'), 'a'.repeat(8192))
    expect(await readCheckedOutBranch(repo)).toEqual({ kind: 'unread' })
  })

  it('skips a gitfile whose git dir has no HEAD', async () => {
    const root = await temp()
    const gitDir = join(root, 'repo', '.git', 'worktrees', 'feat-x')
    await mkdir(gitDir, { recursive: true })
    const wt = join(root, 'wt')
    await mkdir(wt, { recursive: true })
    await writeFile(join(wt, '.git'), `gitdir: ${gitDir}\n`)
    expect(await readCheckedOutBranch(wt)).toEqual({ kind: 'unread' })
  })

  it('is absent outside a repository, for a missing path, and for a file', async () => {
    const root = await temp()
    const plain = join(root, 'plain')
    await mkdir(plain, { recursive: true })
    expect(await readCheckedOutBranch(plain)).toEqual({ kind: 'absent' })
    expect(await readCheckedOutBranch(join(root, 'missing'))).toEqual({ kind: 'absent' })
    const file = join(root, 'file')
    await writeFile(file, 'x')
    expect(await readCheckedOutBranch(file)).toEqual({ kind: 'absent' })
  })
})

describe('handleHead', () => {
  it('rejects a missing or relative path', async () => {
    expect((await handleHead(undefined)).status).toBe(400)
    expect((await handleHead('repo/sub')).status).toBe(400)
  })

  it('answers repo:false outside a repository', async () => {
    const root = await temp()
    const plain = join(root, 'plain')
    await mkdir(plain, { recursive: true })
    expect(await handleHead(plain)).toEqual({ status: 200, body: { repo: false } })
  })

  it('answers the branch, and pending when HEAD is unreadable as a name', async () => {
    const repo = await mainRepo('ref: refs/heads/main\n')
    const sub = join(repo, 'src')
    await mkdir(sub, { recursive: true })
    expect(await handleHead(sub)).toEqual({ status: 200, body: { repo: true, currentBranch: 'main' } })
    await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/hea')
    expect(await handleHead(repo)).toEqual({ status: 200, body: { repo: true, pending: true } })
  })
})
