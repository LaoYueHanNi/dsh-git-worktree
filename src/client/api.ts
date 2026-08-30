/**
 * Browser-side fetch client for the plugin's host routes. Plain fetch against
 * same-origin paths; every failure resolves to `{ error }` so callers can
 * branch without try/catch.
 */

import type {
  CreateBranchResult, CreateWorktreeResult, FetchResult, RepoStatus, RouteError, SwitchResult,
} from '../wire.ts'
import { ROUTE_BRANCH, ROUTE_FETCH, ROUTE_STATUS, ROUTE_SWITCH, ROUTE_WORKTREE } from '../wire.ts'

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
    const payload: unknown = await response.json()
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
 */
export function requestWorktreeCutout(repoPath: string, branch: string): Promise<Call<CreateWorktreeResult>> {
  return post<CreateWorktreeResult>(ROUTE_WORKTREE, { repoPath, branch, cutout: true })
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
 * Create a NEW branch from the directory's current checkout and switch to it
 * in place.
 * @param repoPath - absolute directory whose HEAD the branch is cut from.
 * @param name - user-typed new branch name (validated client-side already).
 */
export function requestCreateBranch(repoPath: string, name: string): Promise<Call<CreateBranchResult>> {
  return post<CreateBranchResult>(ROUTE_BRANCH, { repoPath, name })
}

/**
 * Sync remote-tracking refs (fetch every remote + prune) for the repository.
 * @param repoPath - absolute directory inside the repository.
 */
export function requestFetch(repoPath: string): Promise<Call<FetchResult>> {
  return post<FetchResult>(ROUTE_FETCH, { repoPath })
}
