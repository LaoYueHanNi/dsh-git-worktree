/**
 * Injected business faces: framework actions the entries themselves cannot
 * reach (workspace registration lives on workspaces; session start and
 * directory picking live on uiWorkspace). Session identity and the list
 * snapshot ride the standard kit (`sessionId` / `useSessions`) that
 * ui-session merges onto session-scoped slots.
 */

import type { DeferredWorktreeSpec } from '../wire.ts'

/** Outcome of one lazy auto-prune run, summarized for the caller's toast. */
export interface PruneReport {
  /** Directories fully removed (git half + archives + unregistration). */
  readonly removed: string[]
  /** Directories skipped for uncommitted changes — never forced; they stay
   * for the settings-page manager to surface. */
  readonly skippedDirty: string[]
  /** Directories whose removal threw (Windows file locks, git refusals);
   * recorded and walked past. */
  readonly failed: Array<{ path: string; message: string }>
}

/** One auto-prune deletion request (the force flag rides along for the
 * shared flow's shape; the executor always pins it to false). */
export interface PruneTarget {
  readonly path: string
  readonly force: boolean
  readonly workspaceId?: string
  readonly archiveSessionIds?: readonly string[]
}

/** Context passed when adopting a created/reused worktree directory. */
export interface AdoptWorktreeOptions {
  /**
   * When present and shared-workspace mode (`switchSessionDirectory`) is enabled,
   * switch this blank session's working directory in place instead of spawning
   * another blank session.
   */
  readonly reuseBlankSessionId?: string | undefined
  /**
   * Main repository root owning the worktree, used to locate or register the
   * parent repository Workspace in shared-workspace mode.
   */
  readonly repoRoot?: string | undefined
  /**
   * Optional canonical PR/MR URL to bind to the opened worktree session via
   * host `remote.forgePanel.track` when available.
   */
  readonly trackPrUrl?: string | null | undefined
}

export interface BranchChipInjected {
  /**
   * Open a created/reused worktree directory: registers it as a standalone
   * Workspace by default, or switches a blank session's working directory under
   * the parent repository Workspace when `switchSessionDirectory` is enabled.
   * @param path - absolute worktree directory.
   * @param options - optional blank-session reuse, parent repo hint, and PR/MR URL to track.
   */
  adoptWorktree: (path: string, options?: AdoptWorktreeOptions) => Promise<void>
  /**
   * The DSH-side facts of one worktree removal, read from the live snapshots:
   * whether any session in the directory's workspace is RUNNING (the removal
   * verb withholds — the manager dialog's rule) and how many visible sessions
   * the confirm dialog will spell as "archived too".
   * @param path - absolute worktree directory.
   */
  describeWorktreeRemoval: (path: string) => { running: boolean; archiveCount: number }
  /**
   * Remove one worktree COMPLETELY — the shared removal flow: git first
   * (registration + folder), then the directory's sessions archived and its
   * workspace registration dropped. The checked-out branch survives. Rejects
   * with the failure text for the caller's toast.
   * @param path - absolute worktree directory.
   * @param force - true past uncommitted changes (the confirm dialog already
   * showed the dirty count).
   */
  removeWorktree: (path: string, force: boolean) => Promise<void>
  /**
   * The lazy auto-prune, run AFTER a worktree creation has fully landed
   * (fire-and-forget on the caller's side): reads the switches from the
   * settings scope, scans the storage root, and walks the overflow through
   * the shared removal flow. `undefined` = the switches are off (or the
   * settings scope was not ready) — nothing happened, nothing to toast.
   */
  pruneWorktrees?: (createdPath: string) => Promise<PruneReport | undefined>
  /**
   * Whether clicking the composer branch button should open the commit graph.
   * Read live from the settings snapshot; absent or unready means off.
   */
  openGraphByDefault: () => boolean
  /**
   * Whether shared-workspace directory switching (`switchSessionDirectory`) is
   * currently enabled. When true, new worktree creations are armed lazily until
   * the session's first user message arrives.
   */
  isSwitchSessionDirectory?: () => boolean
  /**
   * Arm a deferred worktree creation on a blank session (reusing the current
   * blank session or spawning a fresh blank session under the parent repo
   * Workspace). Nothing is written to disk until the first message is sent.
   */
  armDeferredWorktree?: (spec: DeferredWorktreeSpec, options?: AdoptWorktreeOptions) => Promise<void>
}
