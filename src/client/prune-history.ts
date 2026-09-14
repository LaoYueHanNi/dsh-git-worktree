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

/** Structural check of ONE stored run. The payload is browser-local JSON an
 * older build (or anything else holding this key) may have written in a
 * different shape, and the settings card reads `run.removed.length` straight
 * into its render — a top-level `Array.isArray` alone would let `[1, 2]`
 * through and take the whole card down with a TypeError. Only the fields the
 * card actually touches are checked; their element shapes stay trusted (a
 * malformed member degrades one line, not the page). */
function isPruneRunEntry(value: unknown): value is PruneRunEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.at === 'number'
    && Array.isArray(entry.removed)
    && Array.isArray(entry.skippedDirty)
    && Array.isArray(entry.failed)
}

/** The recorded runs, newest first; an unreadable/foreign payload reads as
 * "no history" rather than throwing into the settings render — entry by
 * entry, so one bad record costs its own line and nothing else. */
export function readPruneHistory(): readonly PruneRunEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPruneRunEntry) : []
  } catch {
    return []
  }
}
