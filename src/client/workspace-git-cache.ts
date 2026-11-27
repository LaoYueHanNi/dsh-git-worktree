/**
 * Client-side cache of per-workspace git belonging facts (`WorkspaceGitFacts`).
 *
 * Driven by the host's batch `POST /plugin/git-worktree/group` route so context
 * menus and sidebar row decorations can answer "is this workspace/session a git
 * repo or a linked worktree?" in O(1) synchronous memory reads without spawning
 * git processes when a menu opens.
 *
 * Implements the minimal `ObservableSnapshot` shape (`getSnapshot` + `subscribe`)
 * so both React (`useSyncExternalStore`) and DSH `ctx.contextMenus.register`
 * `observe()` can subscribe to it directly.
 */

import type { WorkspaceGitFacts } from '../wire.ts'
import { requestGroupWorktrees } from './api.ts'
import { pathKey } from './worktree-prune.ts'

/** Minimal observable interface shared by useSyncExternalStore and ui-context-menu. */
export interface SnapshotObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Batch git facts fetcher injected for testability; defaults to the host route. */
export type GroupFactsFetcher = (
  paths: readonly string[],
) => Promise<{ ok: true; facts: Record<string, WorkspaceGitFacts | null> } | { ok: false; error: string }>

export interface WorkspaceGitCache extends SnapshotObservable<ReadonlyMap<string, WorkspaceGitFacts | null>> {
  /** Synchronous lookup by absolute directory path (`undefined` = not probed yet, `null` = not a git repo). */
  get(path: string): WorkspaceGitFacts | null | undefined
  /** Probe any paths not yet cached (or in flight) and prune keys no longer in `activePaths` if provided. */
  syncPaths(paths: readonly string[], pruneMissing?: boolean): Promise<void>
  /** Drop one path from the cache (e.g. after worktree deletion) and notify subscribers. */
  invalidate(path: string): void
  /** Force a fresh probe for specific paths (e.g. after branch switch or worktree creation). */
  refresh(paths: readonly string[]): Promise<void>
  /** Stop accepting late responses after plugin teardown. */
  dispose(): void
}

/** Whether cached git facts identify a linked worktree (not the main checkout). */
export function isLinkedWorktreeFacts(facts: WorkspaceGitFacts | null | undefined): facts is WorkspaceGitFacts {
  return facts !== undefined && facts !== null && facts.main === false
}

/**
 * Resolve the filesystem directory of a session from live service snapshots.
 * Prefers the session summary's own `cwd`; falls back to scanning registered
 * workspaces' `sessionIds` so sessions without an inline `cwd` still resolve.
 */
export function resolveSessionPath(
  sessionId: string,
  sessionsById: Readonly<Record<string, { cwd?: string } | undefined>>,
  workspaces: ReadonlyArray<{ path: string; sessionIds: readonly string[] }>,
): string | undefined {
  const cwd = sessionsById[sessionId]?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  const owner = workspaces.find(ws => ws.sessionIds.includes(sessionId))
  return owner?.path
}

/**
 * Create a client-lifetime cache of workspace git facts.
 * @param fetchFacts - batch group-facts transport (defaults to `requestGroupWorktrees`).
 */
export function createWorkspaceGitCache(
  fetchFacts: GroupFactsFetcher = paths => requestGroupWorktrees([...paths]),
): WorkspaceGitCache {
  let snapshot: ReadonlyMap<string, WorkspaceGitFacts | null> = new Map()
  const inFlight = new Set<string>()
  const listeners = new Set<() => void>()
  let disposed = false

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const probe = async (paths: readonly string[], force: boolean): Promise<void> => {
    if (disposed || paths.length === 0) return
    const toQuery: string[] = []
    const queuedKeys = new Set<string>()
    for (const raw of paths) {
      if (raw.length === 0) continue
      const key = pathKey(raw)
      if (queuedKeys.has(key) || inFlight.has(key)) continue
      if (!force && snapshot.has(key)) continue
      queuedKeys.add(key)
      toQuery.push(raw)
    }
    if (toQuery.length === 0) return
    for (const key of queuedKeys) inFlight.add(key)
    try {
      const response = await fetchFacts(toQuery)
      if (disposed || !response.ok) return
      const next = new Map(snapshot)
      let changed = false
      for (const queried of toQuery) {
        if (!Object.prototype.hasOwnProperty.call(response.facts, queried)) continue
        const value = response.facts[queried] ?? null
        const key = pathKey(queried)
        const prev = next.get(key)
        const same = prev === value || (
          prev !== undefined && prev !== null && value !== null
          && prev.repoRoot === value.repoRoot
          && prev.repoName === value.repoName
          && prev.branch === value.branch
          && prev.main === value.main
          && prev.baseBranch === value.baseBranch
        )
        if (!same || !next.has(key)) {
          next.set(key, value)
          changed = true
        }
      }
      if (changed) {
        snapshot = next
        emit()
      }
    } catch {
      // Transient transport error: leave uncached so the next sync retries.
    } finally {
      for (const key of queuedKeys) inFlight.delete(key)
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    get: path => snapshot.get(pathKey(path)),
    syncPaths: async (paths, pruneMissing = false) => {
      if (disposed) return
      if (pruneMissing) {
        const keep = new Set(paths.filter(p => p.length > 0).map(pathKey))
        let pruned = false
        const next = new Map<string, WorkspaceGitFacts | null>()
        for (const [key, value] of snapshot) {
          if (keep.has(key)) next.set(key, value)
          else pruned = true
        }
        if (pruned) {
          snapshot = next
          emit()
        }
      }
      await probe(paths, false)
    },
    invalidate: (path) => {
      const key = pathKey(path)
      if (!snapshot.has(key)) return
      const next = new Map(snapshot)
      next.delete(key)
      snapshot = next
      emit()
    },
    refresh: paths => probe(paths, true),
    dispose: () => {
      disposed = true
      listeners.clear()
      inFlight.clear()
    },
  }
}
