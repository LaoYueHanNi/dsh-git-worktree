/**
 * Injected business faces: framework actions the entries themselves cannot
 * reach (workspace registration lives on workspaces; session start and
 * directory picking live on uiWorkspace). Session identity and the list
 * snapshot ride the standard kit (`sessionId` / `useSessions`) that
 * ui-session merges onto session-scoped slots.
 */

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

export interface BranchChipInjected {
  /**
   * Register a created/reused worktree directory as a real Workspace and hop
   * to its blank session (draft carried by the framework's connect flow).
   * The workspace title defaults to the folder basename, which the host side
   * already names `<repoName>-<branch>` — belonging needs no extra rename.
   * @param path - absolute worktree directory.
   */
  adoptWorktree: (path: string) => Promise<void>
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
}
