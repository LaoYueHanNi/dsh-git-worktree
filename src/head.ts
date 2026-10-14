/**
 * Checked-out branch by reading HEAD, not by spawning git.
 *
 * The branch label polls this while the page is visible. A full `git status`
 * probe is several processes (and ahead/behind grows with the branch list);
 * `git branch --show-current` is one process whose cost is mostly startup.
 * HEAD is a single short text file, and the host process is already resident.
 *
 * Discovery follows git's own walk: from the directory upward until a `.git`
 * entry. A directory is the git dir (main checkout). A file is a gitfile
 * (`gitdir: <path>`, relative paths resolved against the file's directory) —
 * linked worktrees and submodules. The branch name is whatever that git dir's
 * HEAD says.
 *
 * This does not consult `GIT_DIR`. The full status route still goes through
 * git, and that result is what the label actually renders; a disagreement
 * here only decides whether to ask git again.
 */

import { open, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** HEAD is one short line. A buffer that comes back full is a partial write
 * or not a HEAD file — a prefix must not be treated as a branch name. */
const HEAD_READ_MAX = 1024

/** A gitfile is one path. Same rule as {@link HEAD_READ_MAX}. */
const GITDIR_READ_MAX = 4096

/** What a directory's checkout looks like to the poll. */
export type CheckedOutBranch =
  | { kind: 'absent' }
  /** `.git` was found, but HEAD could not be read completely this tick. */
  | { kind: 'unread' }
  /** `name` is the branch, or `HEAD` when detached (the label's existing word). */
  | { kind: 'branch'; name: string }

/** Checked-out branch of `dir`, walking parent directories the way git does. */
export async function readCheckedOutBranch(dir: string): Promise<CheckedOutBranch> {
  try {
    return await discover(dir)
  } catch {
    // A permission error or a path that vanishes mid-read is a skipped tick,
    // not a reason to clear the label.
    return { kind: 'unread' }
  }
}

async function discover(dir: string): Promise<CheckedOutBranch> {
  let cursor: string
  try {
    cursor = await realpath(dir)
  } catch (error) {
    return isEnoent(error) ? { kind: 'absent' } : { kind: 'unread' }
  }
  if (!(await stat(cursor)).isDirectory()) return { kind: 'absent' }

  for (;;) {
    const gitPath = join(cursor, '.git')
    let info: { isDirectory(): boolean; isFile(): boolean }
    try {
      info = await stat(gitPath)
    } catch (error) {
      if (!isEnoent(error)) return { kind: 'unread' }
      const parent = dirname(cursor)
      if (parent === cursor) return { kind: 'absent' }
      cursor = parent
      continue
    }
    if (info.isDirectory()) return readHeadFile(join(gitPath, 'HEAD'))
    if (info.isFile()) return readGitfile(gitPath)
    return { kind: 'unread' }
  }
}

/** Linked worktree / submodule: `.git` is a file pointing at the real git dir. */
async function readGitfile(gitFile: string): Promise<CheckedOutBranch> {
  const text = await readBounded(gitFile, GITDIR_READ_MAX)
  if (typeof text !== 'string') return { kind: 'unread' }
  const line = firstLine(text).trim()
  if (!line.startsWith('gitdir:')) return { kind: 'unread' }
  const target = line.slice('gitdir:'.length).trim()
  if (target === '') return { kind: 'unread' }
  // One hop. A gitfile points at a git dir that holds HEAD, not at another gitfile.
  return readHeadFile(join(resolve(dirname(gitFile), target), 'HEAD'))
}

async function readHeadFile(headPath: string): Promise<CheckedOutBranch> {
  const text = await readBounded(headPath, HEAD_READ_MAX)
  if (typeof text !== 'string') return { kind: 'unread' }
  const name = parseHead(text)
  if (name === undefined) return { kind: 'unread' }
  return { kind: 'branch', name }
}

/**
 * Read at most `max` bytes. `'missing'` is ENOENT; `'truncated'` means the
 * file filled the cap (do not parse a prefix). Other IO errors throw.
 */
async function readBounded(path: string, max: number): Promise<string | 'missing' | 'truncated'> {
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch (error) {
    if (isEnoent(error)) return 'missing'
    throw error
  }
  try {
    const buffer = Buffer.alloc(max)
    const { bytesRead } = await handle.read(buffer, 0, max, 0)
    if (bytesRead >= max) return 'truncated'
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/**
 * The label's word for one HEAD file. `refs/heads/<name>` is that branch.
 * Any other complete form git uses for "not on a branch" (a commit id, or a
 * symbolic ref outside `refs/heads`) is `HEAD`, matching
 * `git branch --show-current` printing nothing. A partial line is `undefined`
 * so the tick is skipped.
 */
function parseHead(text: string): string | undefined {
  const line = firstLine(text).trim()
  if (line === '') return undefined
  if (line.startsWith('ref:')) {
    const ref = line.slice('ref:'.length).trim()
    const heads = 'refs/heads/'
    if (ref.startsWith(heads)) {
      const name = ref.slice(heads.length)
      if (name === '' || name.endsWith('/') || /\s/.test(name)) return undefined
      return name
    }
    // A finished non-branch symref is `refs/<namespace>/<name>`. A torn write
    // (`ref: refs/hea`) never has that second slash, so it stays unread.
    if (/^refs\/[A-Za-z0-9_-]+\/\S+$/.test(ref)) return 'HEAD'
    return undefined
  }
  if (/^[0-9a-f]{40}$/i.test(line) || /^[0-9a-f]{64}$/i.test(line)) return 'HEAD'
  return undefined
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? ''
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
