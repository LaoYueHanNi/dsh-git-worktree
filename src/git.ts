/**
 * Git command wrapper for the host half. All git access goes through one
 * injectable `exec` seam (tests substitute it); every method is plain
 * argument assembly plus porcelain parsing, no ambient state.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path'
import { localBranchName } from './normalize.js'
import type { BranchEntry, WorktreeEntry } from './wire.js'

/** One process result as the seam reports it. */
export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Process executor seam. Runs `file args` with cwd set, captures output as
 * UTF-8 text, and never throws — a non-zero exit is a normal result.
 */
export type Exec = (file: string, args: readonly string[], options: { cwd: string }) => Promise<ExecResult>

/** Failure of one git invocation: non-zero exit with the stderr text. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`)
    this.name = 'GitError'
  }
}

/** Facts the status route assembles: branches, worktrees, repo identity. */
export interface RepoFacts {
  /** Absolute main worktree path (`rev-parse --show-toplevel` of the main dir). */
  repoRoot: string
  /** Main repository directory basename. */
  repoName: string
  /** Branch checked out by the queried directory. */
  currentBranch: string
  branches: BranchEntry[]
  worktrees: WorktreeEntry[]
}

/** Real executor over node:child_process with a hard timeout. */
export function childProcessExec(file: string, args: readonly string[], options: { cwd: string }): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    execFile(file, args, { cwd: options.cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      // execFile reports any failure (non-zero exit, spawn error, timeout) as
      // a truthy error; the specific exit code never carries signal here —
      // stderr does — so every failure collapses to 1.
      resolvePromise({ code: error !== null ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

/** Run one git command; a non-zero exit raises {@link GitError} with stderr. */
async function git(exec: Exec, cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', args, { cwd })
  if (result.code !== 0) throw new GitError(args, result.code, result.stderr)
  return result.stdout
}

/** Run one git command, mapping a non-zero exit to undefined instead of throwing. */
async function gitMaybe(exec: Exec, cwd: string, args: readonly string[]): Promise<string | undefined> {
  const result = await exec('git', args, { cwd })
  return result.code === 0 ? result.stdout : undefined
}

/** Directory-existence seam over the parsed worktree registrations. */
export type DirExists = (path: string) => boolean

/** Real existence check. */
export const fsDirExists: DirExists = path => existsSync(path)

/**
 * Resolve a directory to repository facts, or undefined outside any git
 * repository (including the `git` binary missing: ENOENT surfaces as a
 * non-zero exit through the seam).
 * @param exec - executor seam.
 * @param path - absolute directory the workspace reports.
 * @param dirExists - existence seam for stale-registration filtering.
 */
export async function probeRepo(exec: Exec, path: string, dirExists: DirExists = fsDirExists): Promise<RepoFacts | undefined> {
  const top = await gitMaybe(exec, path, ['rev-parse', '--show-toplevel'])
  if (top === undefined) return undefined
  const commonDir = await gitMaybe(exec, path, ['rev-parse', '--git-common-dir'])
  // repoName comes from the shared .git location: a linked worktree's own
  // toplevel would name the branch folder, not the repository. Both git
  // outputs carry forward slashes on Windows — normalize every derived path.
  const repoRoot = normalize(top.trim())
  const gitDir = commonDir !== undefined && commonDir.trim() !== ''
    ? normalize(resolve(path, commonDir.trim()))
    : resolve(repoRoot, '.git')
  return {
    repoRoot,
    repoName: basename(dirname(gitDir)),
    currentBranch: await currentBranch(exec, path),
    branches: await listBranches(exec, repoRoot),
    // A stale registration (directory removed behind git's back) must not
    // reach the UI as a real worktree — it would disable branch rows for a
    // folder that no longer exists.
    worktrees: (await listWorktrees(exec, repoRoot)).filter(w => dirExists(w.path)),
  }
}

/** Currently checked-out branch of a directory; `HEAD` when detached or unborn. */
async function currentBranch(exec: Exec, cwd: string): Promise<string> {
  const name = await gitMaybe(exec, cwd, ['branch', '--show-current'])
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? 'HEAD' : trimmed
}

/** Local branches plus remote-only branches (first remote only, `<remote>/HEAD` dropped). */
async function listBranches(exec: Exec, repoRoot: string): Promise<BranchEntry[]> {
  const localOut = await git(exec, repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])
  const locals = localOut.split('\n').map(l => l.trim()).filter(l => l !== '')
  const entries: BranchEntry[] = locals.map(name => ({ name, kind: 'local' }))
  const remoteOut = await gitMaybe(exec, repoRoot, ['for-each-ref', 'refs/remotes', '--format=%(refname:short)'])
  if (remoteOut !== undefined) {
    const seenRemotes = new Set<string>()
    for (const line of remoteOut.split('\n')) {
      const name = line.trim()
      if (name === '') continue
      const localName = localBranchName(name)
      if (localName === 'HEAD' || locals.includes(localName)) continue
      const remote = name.slice(0, name.length - localName.length - 1)
      // One remote only: a branch visible on several remotes collapses to the first.
      if (seenRemotes.size === 1 && !seenRemotes.has(remote)) continue
      seenRemotes.add(remote)
      entries.push({ name, kind: 'remote' })
    }
  }
  return entries
}

/** Parse `git worktree list --porcelain` into entries, main first. */
async function listWorktrees(exec: Exec, repoRoot: string): Promise<WorktreeEntry[]> {
  const out = await git(exec, repoRoot, ['worktree', 'list', '--porcelain'])
  const entries: WorktreeEntry[] = []
  let path: string | undefined
  let branch: string | undefined
  let detached = false
  const flush = (): void => {
    if (path === undefined) return
    // Porcelain reports forward slashes on Windows; normalize so consumers
    // can compare against join()-built paths.
    entries.push({ path: normalize(path), branch: detached || branch === undefined ? undefined : branch.replace('refs/heads/', ''), main: entries.length === 0 })
    path = undefined
    branch = undefined
    detached = false
  }
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).trim()
    } else if (line === 'detached') {
      detached = true
    }
  }
  flush()
  return entries
}

/**
 * Resolve a branch display name against the authoritative branch list of the
 * repository.
 * @returns the local name plus the tracking remote when the display name is
 * remote-only, or undefined when neither shape exists.
 */
async function resolveBranch(exec: Exec, repoRoot: string, branch: string): Promise<{ local: string; remote: string | undefined } | undefined> {
  const localsOut = await git(exec, repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])
  const locals = localsOut.split('\n').map(l => l.trim()).filter(l => l !== '')
  if (locals.includes(branch)) return { local: branch, remote: undefined }
  const local = localBranchName(branch)
  if (local !== branch && locals.includes(local)) return undefined // the display names a remote, but the local twin exists: use the twin
  const remoteOut = await gitMaybe(exec, repoRoot, ['for-each-ref', 'refs/remotes', `refs/remotes/${branch}`, '--format=%(refname:short)'])
  if (remoteOut !== undefined && remoteOut.trim() !== '') return { local, remote: branch.slice(0, branch.length - local.length - 1) }
  return undefined
}

/**
 * Create (or reuse) the worktree for one branch.
 *
 * Idempotence: git allows one worktree per checked-out branch, so an existing
 * worktree already on `branch` (compared by local name) is returned unreused.
 * A local branch gets `git worktree add <path> <name>`; a remote-only branch
 * gets a new local twin via `git worktree add <path> -b <name> <remoteRef>`.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param branch - branch display name.
 * @param targetPath - absolute directory to create.
 * @returns the worktree path and whether this call created it.
 */
export async function addWorktree(
  exec: Exec,
  repoRoot: string,
  branch: string,
  targetPath: string,
  dirExists: DirExists = fsDirExists,
): Promise<{ path: string; created: boolean }> {
  const resolved = await resolveBranch(exec, repoRoot, branch)
  if (resolved === undefined) throw new GitError(['worktree', 'add'], 1, `branch "${branch}" not found`)
  let worktrees = await listWorktrees(exec, repoRoot)
  const existing = worktrees.find(w => w.branch === resolved.local)
  if (existing !== undefined && dirExists(existing.path)) return { path: existing.path, created: false }
  if (existing !== undefined) {
    // Stale registration: the directory is gone but git's administrative
    // record still claims the branch. Prune (git-side no-op when clean) and
    // re-read before creating, or `worktree add` would refuse the branch.
    await git(exec, repoRoot, ['worktree', 'prune'])
    worktrees = await listWorktrees(exec, repoRoot)
    const afterPrune = worktrees.find(w => w.branch === resolved.local)
    if (afterPrune !== undefined && dirExists(afterPrune.path)) return { path: afterPrune.path, created: false }
  }
  if (resolved.remote === undefined) {
    await git(exec, repoRoot, ['worktree', 'add', targetPath, resolved.local])
  } else {
    await git(exec, repoRoot, ['worktree', 'add', targetPath, '-b', resolved.local, branch])
  }
  return { path: targetPath, created: true }
}

/**
 * Plan a new branch name to cut out of `base`: `<base>-wt`, or the first
 * `-wt<N>` suffix not already taken (`main` → `main-wt`; if that exists,
 * `main-wt2`, …). One `for-each-ref` pass decides; the worktree folder
 * name derives from the returned name, so the caller should resolve it
 * BEFORE computing the target path. With `folderTaken` given, a name is
 * only free when its storage folder is free too: a leftover folder of a
 * since-deleted branch would otherwise fail `worktree add` with a bare
 * "already exists" — the suffix walk skips it the same way.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param base - base branch local name (or `HEAD` when detached).
 * @param folderTaken - storage-folder occupancy probe (branch name → taken).
 * @returns the free cutout branch name.
 */
export async function cutoutBranchName(
  exec: Exec,
  repoRoot: string,
  base: string,
  folderTaken?: (branch: string) => boolean,
): Promise<string> {
  const out = await git(exec, repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])
  const locals = new Set(out.split('\n').map(l => l.trim()).filter(l => l !== ''))
  // `base` is the checked-out branch (`branch --show-current` output), which
  // never carries a remote prefix — pass it through verbatim so a local name
  // containing '/' survives.
  const free = (candidate: string): boolean =>
    !locals.has(candidate) && !(folderTaken?.(candidate) ?? false)
  const stem = `${base}-wt`
  if (free(stem)) return stem
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}${i}`
    if (free(candidate)) return candidate
  }
}

/**
 * Create a worktree on a brand-new branch cut out of `base`: the base is
 * checked out by the main worktree (git forbids a second worktree on it),
 * so the new branch is created from it and checked out in the fresh
 * worktree instead.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param base - base branch local name (`main` or `HEAD`).
 * @param newBranch - the cutout branch name (see {@link cutoutBranchName}).
 * @param targetPath - absolute directory to create.
 */
export async function addWorktreeCutout(
  exec: Exec,
  repoRoot: string,
  base: string,
  newBranch: string,
  targetPath: string,
): Promise<void> {
  await git(exec, repoRoot, ['worktree', 'add', targetPath, '-b', newBranch, base])
}

/**
 * In-place branch switch of the main checkout. A remote display name relies
 * on git's dwim: `git switch <local>` creates the tracking branch when
 * exactly one remote has it.
 * @param exec - executor seam.
 * @param repoRoot - main worktree directory.
 * @param branch - branch display name.
 * @returns the local branch name now checked out.
 */
export async function switchBranch(exec: Exec, repoRoot: string, branch: string): Promise<string> {
  const resolved = await resolveBranch(exec, repoRoot, branch)
  if (resolved === undefined) throw new GitError(['switch'], 1, `branch "${branch}" not found`)
  try {
    await git(exec, repoRoot, ['switch', resolved.local])
  } catch (error) {
    // A stale worktree registration claims the branch; prune (no-op on a
    // healthy repo) and retry once — a live worktree still refuses, as it must.
    const stale = error instanceof GitError && error.stderr.includes('already used by worktree')
    if (!stale) throw error
    await git(exec, repoRoot, ['worktree', 'prune'])
    await git(exec, repoRoot, ['switch', resolved.local])
  }
  return resolved.local
}

/** Guard for route inputs: a non-empty absolute directory path. */
export function isAbsoluteDir(value: string): boolean {
  return value.trim() !== '' && isAbsolute(value)
}
