/**
 * Unified Session working-directory resolution and dual-mode worktree
 * ownership helpers.
 *
 * Supports both:
 * 1. Standalone workspace mode: a worktree is registered as its own Workspace
 *    (`workspace.path === worktreePath`).
 * 2. Shared workspace mode (`switchSessionDirectory`): a session stays under
 *    its parent repository Workspace while its projected `workingDirectory`
 *    points at `worktreePath` (or a subdirectory inside it).
 */

import { freshestUpdatedAt, pathKey, type ActivitySummary } from './worktree-prune.ts'

/** Minimal Session summary shape read across snapshots. */
export interface SessionSummaryLike {
  readonly cwd?: string | undefined
  readonly running?: boolean | undefined
  readonly blank?: boolean | undefined
  readonly origin?: 'subagent' | string | undefined
  readonly updatedAt?: number | undefined
  readonly retainedBy?: { readonly mainView?: number | undefined } | undefined
  readonly projectionValues?: Readonly<Record<string, unknown>> | undefined
}

/** Minimal Session list snapshot matching DSH `SessionListState`. */
export interface SessionListSnapshotLike {
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
  readonly projectionsBySession?: Readonly<Record<string, { readonly values?: Readonly<Record<string, unknown>> | undefined } | undefined>> | undefined
}

/** Minimal Sessions service slice for gesture-time directory reads. */
export interface SessionsDirectorySourceLike {
  readonly list: { readonly getSnapshot: () => SessionListSnapshotLike }
  readonly binding?: (sessionId: never) => {
    readonly session?: {
      readonly projections?: {
        readonly faceOf?: (key: string) => { readonly getSnapshot: () => unknown }
      }
    }
  } | undefined
}

/** Minimal Workspace row slice. */
export interface WorkspaceRowLike {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

function readProjectedString(values: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  if (values === undefined) return undefined
  const value = values[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Select a Session's effective working directory from a sessions list snapshot,
 * matching DSH's `selectSessionDirectory` precedence:
 * 1. `projectionsBySession[sessionId].values.workingDirectory`
 * 2. `byId[sessionId].projectionValues.workingDirectory`
 * 3. `byId[sessionId].cwd` (original session header directory)
 */
export function selectSessionDirectory(
  state: SessionListSnapshotLike,
  sessionId: string,
): string | undefined {
  const projected = readProjectedString(state.projectionsBySession?.[sessionId]?.values, 'workingDirectory')
    ?? readProjectedString(state.byId[sessionId]?.projectionValues, 'workingDirectory')
  if (projected !== undefined) return projected
  const cwd = state.byId[sessionId]?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Whether `sessionId` is currently managed by official `forgeWorktree`
 * projection (checks both `projectionsBySession` and `byId.projectionValues`).
 */
export function hasForgeManagedWorktree(
  state: SessionListSnapshotLike,
  sessionId: string,
): boolean {
  const fromProjections = state.projectionsBySession?.[sessionId]?.values?.forgeWorktree
  if (fromProjections !== undefined && fromProjections !== null) return true
  const fromSummary = state.byId[sessionId]?.projectionValues?.forgeWorktree
  return fromSummary !== undefined && fromSummary !== null
}

/**
 * Resolve a Session's effective directory at gesture/service time:
 * live connected projection face → sessions list snapshot → owning workspace path.
 */
export function resolveEffectiveSessionPath(
  sessions: SessionsDirectorySourceLike,
  sessionId: string,
  workspaces: readonly WorkspaceRowLike[],
): string | undefined {
  const liveValue = sessions.binding?.(sessionId as never)?.session?.projections?.faceOf?.('workingDirectory')?.getSnapshot()
  if (typeof liveValue === 'string' && liveValue.length > 0) return liveValue
  const fromList = selectSessionDirectory(sessions.list.getSnapshot(), sessionId)
  if (fromList !== undefined) return fromList
  const owner = workspaces.find(ws => ws.sessionIds.includes(sessionId))
  return owner?.path
}

/**
 * Normalize a directory path into a slash-canonical comparison key (`/` separators,
 * no trailing slash except root, lowercased for Windows case-insensitivity).
 */
function canonicalPathKey(raw: string): string {
  return pathKey(raw)
}

/**
 * Whether `candidate` equals `worktreePath` or lies inside it as a subdirectory.
 * Guards against sibling-prefix collisions (`/repo/wt` vs `/repo/wt2`).
 */
export function isPathWithinWorktree(candidate: string | undefined, worktreePath: string): boolean {
  if (candidate === undefined || candidate.length === 0) return false
  const target = canonicalPathKey(worktreePath)
  const dir = canonicalPathKey(candidate)
  if (target === '' || dir === '') return false
  if (dir === target) return true
  const prefix = target.endsWith('/') ? target : `${target}/`
  return dir.startsWith(prefix)
}

/**
 * Decide whether a linked-worktree session should display session-level
 * worktree badges/hover rows in the sidebar.
 *
 * - Returns `false` when the session belongs to a standalone worktree Workspace
 *   (the workspace itself already represents the worktree directory, so
 *   stamping every child session row/hover is redundant).
 * - Returns `true` when the session lives under a parent repository Workspace
 *   and entered the linked worktree by switching its `workingDirectory`
 *   (shared-workspace mode).
 */
export function isSessionSwitchedWorktree(
  sessionId: string,
  effectiveSessionPath: string,
  workspaces: readonly WorkspaceRowLike[],
  isLinkedWorktreePath?: (path: string) => boolean,
): boolean {
  const owner = workspaces.find(ws => ws.sessionIds.includes(sessionId))
  if (owner === undefined) return false
  if (canonicalPathKey(owner.path) === canonicalPathKey(effectiveSessionPath)) return false
  if (isPathWithinWorktree(effectiveSessionPath, owner.path) && isLinkedWorktreePath?.(owner.path) === true) {
    return false
  }
  return true
}

/**
 * Find an existing unarchived blank session under `parentWorkspace` whose
 * effective working directory already matches `targetPath` exactly.
 *
 * Mirrors DSH's `connectWorkspace` blank-session reuse without stealing blank
 * sessions belonging to the main checkout or a different worktree.
 */
export function findReusableBlankSessionInWorktree(
  parentWorkspace: WorkspaceRowLike,
  targetPath: string,
  sessionsState: SessionListSnapshotLike,
  archivedSessionIds: readonly string[],
): string | undefined {
  const archived = new Set(archivedSessionIds)
  const targetKey = canonicalPathKey(targetPath)
  for (const sessionId of parentWorkspace.sessionIds) {
    if (archived.has(sessionId)) continue
    const summary = sessionsState.byId[sessionId]
    if (summary === undefined || summary.blank !== true || summary.origin === 'subagent') continue
    const effectiveDir = selectSessionDirectory(sessionsState, sessionId)
    if (effectiveDir !== undefined && canonicalPathKey(effectiveDir) === targetKey) {
      return sessionId
    }
  }
  return undefined
}

/** How a worktree is attached in DSH: standalone Workspace, session directory switch, or unbound. */
export type WorktreeBindingMode = 'standalone' | 'session' | 'none'

/** Aggregated DSH-side ownership facts for one worktree directory across both modes. */
export interface WorktreeOwnershipFacts {
  /** True when any session currently working in this worktree is running. */
  readonly running: boolean
  /**
   * Present ONLY when a standalone Workspace is registered directly on `worktreePath`.
   * Always `undefined` in shared-workspace mode so the parent repository Workspace is
   * never deleted during worktree removal or auto-prune.
   */
  readonly workspaceId: string | undefined
  /** Non-blank, non-subagent, unarchived sessions working in this worktree. */
  readonly archiveIds: string[]
  /** Freshest qualifying session updatedAt timestamp (0 when none). */
  readonly activity: number
  /** Current DSH attachment mode for display badges in the worktree manager. */
  readonly mode: WorktreeBindingMode
}

/**
 * Compute removal/prune ownership facts for `worktreePath` across both
 * standalone-workspace and shared-workspace (session-directory) sessions.
 */
export function collectWorktreeOwnership(
  worktreePath: string,
  workspaces: readonly WorkspaceRowLike[],
  sessionsState: SessionListSnapshotLike,
  archivedSessionIds: readonly string[],
): WorktreeOwnershipFacts {
  const targetKey = canonicalPathKey(worktreePath)
  const standaloneWorkspace = workspaces.find(item => canonicalPathKey(item.path) === targetKey)
  const archived = new Set(archivedSessionIds)
  const memberIds = new Set<string>()

  // 1. Every session whose effective working directory sits inside this worktree.
  for (const sessionId of Object.keys(sessionsState.byId)) {
    const effectiveDir = selectSessionDirectory(sessionsState, sessionId)
    if (isPathWithinWorktree(effectiveDir, worktreePath)) {
      memberIds.add(sessionId)
    }
  }

  // 2. Fallback for standalone workspace rows whose session summaries omit `cwd`
  //    (for example minimal test fixtures or cold summaries before metadata loads).
  if (standaloneWorkspace !== undefined) {
    for (const sessionId of standaloneWorkspace.sessionIds) {
      const effectiveDir = selectSessionDirectory(sessionsState, sessionId)
      if (effectiveDir === undefined || isPathWithinWorktree(effectiveDir, worktreePath)) {
        memberIds.add(sessionId)
      }
    }
  }

  let running = false
  let hasSessionBinding = false
  const archiveIds: string[] = []
  const activitySummaries: Array<ActivitySummary | undefined> = []

  for (const sessionId of memberIds) {
    const summary = sessionsState.byId[sessionId]
    if (summary === undefined) continue
    if (typeof summary.updatedAt === 'number') {
      activitySummaries.push({
        updatedAt: summary.updatedAt,
        ...(summary.blank === undefined ? {} : { blank: summary.blank }),
        ...(summary.origin === undefined ? {} : { origin: summary.origin }),
      })
    }
    if (summary.running === true) running = true
    if (summary.origin === 'subagent') continue
    if (!archived.has(sessionId)) {
      hasSessionBinding = true
      if (!summary.blank) archiveIds.push(sessionId)
    }
  }

  const mode: WorktreeBindingMode = standaloneWorkspace !== undefined
    ? 'standalone'
    : hasSessionBinding
      ? 'session'
      : 'none'

  return {
    running,
    workspaceId: standaloneWorkspace?.workspaceId,
    archiveIds,
    activity: freshestUpdatedAt(activitySummaries),
    mode,
  }
}
