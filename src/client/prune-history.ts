/**
 * The auto-prune run log, browser-local (localStorage): one entry per lazy
 * prune that had anything to say — which run, which directories (with the
 * repository/branch belonging the scan knew), what was skipped or failed.
 * The settings card's 清理记录 section reads it, so a misjudged activity
 * (a directory used only through the terminal reads as stale) is
 * discoverable after the fact instead of vanishing with the toast.
 *
 * localStorage, deliberately NOT the settings document: the log is an
 * audit trail of browser-side deletions, per-browser by nature (the
 * sessions whose activity ordered the deletion live in this browser too),
 * and must never round-trip through the plugin config a second browser
 * would sync.
 *
 * @module git-worktree/client/prune-history
 */

/** One recorded prune run. `removed` carries the belonging the /worktrees-all
 * scan knew (the plan's targets only know paths); `skippedDirty`/`failed`
 * keep the run's exceptions so the record explains a "nothing removed" run. */
export interface PruneRunEntry {
  /** Epoch ms when the run finished. */
  readonly at: number
  readonly removed: ReadonlyArray<{ path: string; repoName: string; branch: string }>
  readonly skippedDirty: readonly string[]
  readonly failed: ReadonlyArray<{ path: string; message: string }>
}

const KEY = 'git-worktree:prune-history'
/** The log is a recent-activity trail, not an archive: the oldest runs fall
 * off once this many are kept. */
const MAX_RUNS = 20

/** Append one finished run (newest first), trimming the tail past
 * {@link MAX_RUNS}. Best-effort: a storage write that throws (private mode,
 * quota) swallows — the toast already told the user what happened. */
export function recordPruneRun(entry: PruneRunEntry): void {
  try {
    const next = [entry, ...readPruneHistory()].slice(0, MAX_RUNS)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable: the log is best-effort, the prune itself ran.
  }
}

/** The recorded runs, newest first; an unreadable/foreign payload reads as
 * "no history" rather than throwing into the settings render. */
export function readPruneHistory(): readonly PruneRunEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as PruneRunEntry[] : []
  } catch {
    return []
  }
}
