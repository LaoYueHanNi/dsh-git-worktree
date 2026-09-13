/**
 * Browser-side fetch client for the plugin's host routes. Plain fetch against
 * same-origin paths; every failure resolves to `{ error }` so callers can
 * branch without try/catch.
 */

import type {
  CreateBranchResult, CreateWorktreeResult, DeleteBranchResult, EnsureDirectoryResult, FetchResult, GroupWorkspacesResult, InspectWorktreeResult, PathExistsResult, PurgeDirectoryResult, RemoveWorktreeResult, RenameBranchResult, RepoStatus, RouteError, SwitchResult, UpdateResult, WorktreesAllResult,
} from '../wire.ts'
import { ROUTE_BRANCH, ROUTE_BRANCH_DELETE, ROUTE_BRANCH_RENAME, ROUTE_ENSURE_DIRECTORY, ROUTE_EXISTS, ROUTE_FETCH, ROUTE_GROUP, ROUTE_INSPECT, ROUTE_PURGE, ROUTE_REMOVE, ROUTE_STATUS, ROUTE_SWITCH, ROUTE_UPDATE, ROUTE_WORKTREE, ROUTE_WORKTREES_ALL } from '../wire.ts'

/** One route call outcome: the parsed body, or the error envelope text. */
type Call<T> = (T & { ok: true }) | { ok: false; error: string }

/** POST one JSON body and parse the uniform envelope. */
async function post<T>(url: string, body: unknown): Promise<Call<T>> {
  return send<T>('POST', url, body)
}

/** Send one JSON body with any method and parse the uniform envelope. */
async function send<T>(method: string, url: string, body: unknown): Promise<Call<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      // An empty or non-JSON body (e.g. a 404 from a host that has not
      // loaded this build yet): the status code is the whole message.
      return { ok: false, error: `HTTP ${String(response.status)}` }
    }
    if (!response.ok) {
      const error = payload as RouteError
      return { ok: false, error: error.error ?? `HTTP ${String(response.status)}` }
    }
    return { ...(payload as T), ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Repository status for one directory.
 * @param path - absolute workspace directory.
 */
export async function fetchStatus(path: string): Promise<Call<RepoStatus>> {
  try {
    const response = await fetch(`${ROUTE_STATUS}?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) return { ok: false, error: `HTTP ${String(response.status)}` }
    return { ...(await response.json() as RepoStatus), ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Create or reuse the worktree for a branch.
 * @param repoPath - absolute directory inside the repository.
 * @param branch - branch display name.
 */
export function requestWorktree(repoPath: string, branch: string): Promise<Call<CreateWorktreeResult>> {
  return post<CreateWorktreeResult>(ROUTE_WORKTREE, { repoPath, branch })
}

/**
 * Cut a NEW branch out of the current checkout and isolate it in a fresh
 * worktree (the current branch itself is occupied by the main worktree).
 * @param repoPath - absolute directory inside the repository.
 * @param branch - the current checkout's branch (or `HEAD` when detached).
 * @param name - explicit name for the new branch; omitted, the host
 * derives `<branch>-wt`, suffixing past taken names.
 */
export function requestWorktreeCutout(repoPath: string, branch: string, name?: string): Promise<Call<CreateWorktreeResult>> {
  return post<CreateWorktreeResult>(ROUTE_WORKTREE, { repoPath, branch, cutout: true, ...(name === undefined ? {} : { name }) })
}

/**
 * Switch the main checkout in place.
 * @param repoPath - absolute directory inside the main worktree.
 * @param branch - branch display name.
 */
export function requestSwitch(repoPath: string, branch: string): Promise<Call<SwitchResult>> {
  return post<SwitchResult>(ROUTE_SWITCH, { repoPath, branch })
}

/**
 * Create a NEW branch. Without `from`: cut from the directory's current
 * checkout and switch to it in place (the original in-place shape). With
 * `from` (a local branch or remote-tracking ref): created AT that start
 * point — left unchecked-out by default (the row menu's 新建), or checked
 * out here too with `checkout` (the row menu's 新建并检出).
 * @param repoPath - absolute directory inside the repository.
 * @param name - user-typed new branch name (validated client-side already).
 * @param from - optional start point; absent keeps the in-place semantics.
 * @param checkout - with `from`, also check the new branch out here.
 */
export function requestCreateBranch(repoPath: string, name: string, from?: string, checkout?: boolean): Promise<Call<CreateBranchResult>> {
  if (from === undefined) return post<CreateBranchResult>(ROUTE_BRANCH, { repoPath, name })
  return post<CreateBranchResult>(ROUTE_BRANCH, { repoPath, name, from, ...(checkout === true ? { checkout: true } : {}) })
}

/**
 * Rename a LOCAL branch (`git branch -m`); repository-wide, worktree HEADs
 * follow.
 * @param repoPath - absolute directory inside the repository.
 * @param name - branch to rename.
 * @param newName - user-typed new name (validated client-side already).
 */
export function requestRenameBranch(repoPath: string, name: string, newName: string): Promise<Call<RenameBranchResult>> {
  return post<RenameBranchResult>(ROUTE_BRANCH_RENAME, { repoPath, name, newName })
}

/**
 * Delete a LOCAL branch with the safe form (`git branch -d`); git refuses
 * unmerged commits and branches checked out in any worktree.
 * @param repoPath - absolute directory inside the repository.
 * @param name - branch to delete.
 */
export function requestDeleteBranch(repoPath: string, name: string): Promise<Call<DeleteBranchResult>> {
  return post<DeleteBranchResult>(ROUTE_BRANCH_DELETE, { repoPath, name })
}

/**
 * Sync remote-tracking refs (fetch every remote + prune) for the repository.
 * @param repoPath - absolute directory inside the repository.
 */
export function requestFetch(repoPath: string): Promise<Call<FetchResult>> {
  return post<FetchResult>(ROUTE_FETCH, { repoPath })
}

/**
 * Update the CURRENT checkout: fetch every remote, then fast-forward the
 * checked-out branch to its upstream.
 * @param repoPath - absolute directory whose checked-out branch is updated.
 */
export function requestUpdate(repoPath: string): Promise<Call<UpdateResult>> {
  return post<UpdateResult>(ROUTE_UPDATE, { repoPath })
}

/**
 * Git belonging facts for a batch of workspace directories; a path outside
 * any git repository answers null, a failed route call answers the error
 * envelope (the sidebar then renders flat, its degrade shape).
 * @param paths - absolute workspace directories to probe.
 */
export async function requestGroupWorktrees(paths: readonly string[]): Promise<Call<GroupWorkspacesResult>> {
  return post<GroupWorkspacesResult>(ROUTE_GROUP, { paths })
}

/**
 * Pre-delete facts for one worktree directory: the uncommitted-file count
 * (lost with the folder) and the branch's ahead count (kept).
 * @param path - absolute worktree directory.
 */
export function requestInspectWorktree(path: string): Promise<Call<InspectWorktreeResult>> {
  return post<InspectWorktreeResult>(ROUTE_INSPECT, { path })
}

/**
 * Remove one linked worktree (git registration + folder). `force` rides
 * `--force` past uncommitted changes the confirm dialog already showed.
 * @param path - absolute worktree directory to delete.
 * @param force - delete past uncommitted changes.
 */
export function requestRemoveWorktree(path: string, force: boolean): Promise<Call<RemoveWorktreeResult>> {
  return post<RemoveWorktreeResult>(ROUTE_REMOVE, { path, force })
}

/**
 * Batch directory-existence probe (true = exists AND is a directory). The
 * sidebar gates register-as-workspace on this so a missing folder never
 * reaches the DSH workspace API.
 * @param paths - absolute directories to probe.
 */
export function requestPathExists(paths: readonly string[]): Promise<Call<PathExistsResult>> {
  return post<PathExistsResult>(ROUTE_EXISTS, { paths })
}

/**
 * Recreate a missing worktree storage slot (`mkdir -p`). The host gates this
 * to paths directly inside the storage root; historical sessions reattach
 * automatically once the directory is back.
 * @param path - the missing slot directory (absolute).
 */
export function requestEnsureDirectory(path: string): Promise<Call<EnsureDirectoryResult>> {
  return post<EnsureDirectoryResult>(ROUTE_ENSURE_DIRECTORY, { path })
}

/**
 * Scan the worktree storage root: git facts for every direct child directory
 * (the slots this plugin plans). Orphan/foreign folders answer null facts —
 * the manager dialog shows them as unrecognized.
 */
export function requestWorktreesAll(): Promise<Call<WorktreesAllResult>> {
  return post<WorktreesAllResult>(ROUTE_WORKTREES_ALL, {})
}

/**
 * Delete a NON-git directory sitting directly inside the storage root (an
 * orphaned leftover whose .git is already gone). The host triple-gates this:
 * slot boundary, real directory, no git identity — anything git still
 * recognizes must go through requestRemoveWorktree instead.
 * @param path - the leftover directory (absolute).
 */
export function requestPurgeDirectory(path: string): Promise<Call<PurgeDirectoryResult>> {
  return post<PurgeDirectoryResult>(ROUTE_PURGE, { path })
}
