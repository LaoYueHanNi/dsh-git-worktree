/**
 * Lazy worktree pruning: the plan (which paths overstay the global cap,
 * least-recently-active first) as a pure function over browser-side facts,
 * plus the sequential executor that walks the plan through the shared
 * removal flow. Deliberately browser-side end to end — the DSH half of a
 * removal (session archives, workspace unregistration) only exists here,
 * and the trigger (a fresh worktree creation) only happens in a browser.
 *
 * Activity is the freshest `updatedAt` across the directory's non-blank,
 * non-subagent, non-archived sessions; a directory with no such session is
 * the least active thing in the room (activity 0). Git-side evidence does
 * not participate: a directory used only through the terminal reads as
 * stale — the accepted trade recorded in the pruning decision record.
 *
 * @module git-worktree/client/worktree-prune
 */

import type { PruneReport, PruneTarget } from './slots.ts'
import { removeWorktreeFully, type WorktreeRemoveDeps } from './worktree-remove-flow.ts'

/** Canonical-ish key for cross-source path comparison: both sides come from
 * the same host, but the scan assembles `<rootDir>/<child>` while the
 * workspace model stores its own canonical spelling — separators are the
 * only drift worth papering over. */
export function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Inputs of the plan, all browser-side facts. */
export interface PrunePlanInput {
  /** Absolute directories of every VALID worktree the scan found (orphans
   * — the scan's null-fact entries — never reach this list and never count
   * against the cap). */
  readonly paths: readonly string[]
  /** Absolute directory → freshest session `updatedAt` (epoch ms; absent or
   * 0 = no qualifying session = least active). */
  readonly activity: Readonly<Record<string, number>>
  /** The global cap the plan trims down to; a value under 1 is clamped
   * (0 would read as "create then self-delete everything else"). */
  readonly keep: number
  /** Absolute directories the executor must never touch: the worktree this
   * creation just made, the current session's directory, any directory with
   * a running session. */
  readonly exclude: ReadonlySet<string>
}

/**
 * Which worktrees the lazy prune removes, least-recently-active first.
 * The cap counts every valid worktree INCLUDING the excluded ones (the
 * fresh creation counts against the cap it may have just overfilled), but
 * excluded directories are never candidates: the plan deletes the
 * overflow's worth of the least-active non-excluded paths, so a cap
 * tighter than the exclusion set simply deletes nothing this round.
 * Ties (two never-used directories) break alphabetically for a stable,
 * testable order.
 */
export function planPrune(input: PrunePlanInput): string[] {
  const keep = Math.max(1, Math.floor(input.keep))
  const overflow = Math.max(0, input.paths.length - keep)
  if (overflow === 0) return []
  const excluded = new Set([...input.exclude].map(pathKey))
  return input.paths
    .filter(path => !excluded.has(pathKey(path)))
    .slice()
    .sort((a, b) => (input.activity[pathKey(a)] ?? 0) - (input.activity[pathKey(b)] ?? 0) || pathKey(a).localeCompare(pathKey(b)))
    .slice(0, overflow)
}

/** The executor's face: the removal flow's deps plus the dirty check. */
export interface AutoPruneDeps extends WorktreeRemoveDeps {
  /** Pre-delete facts of one directory; the count decides skip vs remove. */
  readonly inspectWorktree: (path: string) => Promise<{ dirty: number }>
}

/**
 * Walk the plan sequentially: a candidate with uncommitted changes is
 * SKIPPED, never forced (the manager dialog is where those get a human
 * decision); a removal that throws is recorded and the walk continues, so
 * one locked directory cannot strand the rest. Every removal rides the
 * shared flow with `force: false`, always.
 */
export async function runAutoPrune(deps: AutoPruneDeps, targets: readonly PruneTarget[]): Promise<PruneReport> {
  const report: PruneReport = { removed: [], skippedDirty: [], failed: [] }
  for (const target of targets) {
    try {
      const facts = await deps.inspectWorktree(target.path)
      if (facts.dirty > 0) {
        report.skippedDirty.push(target.path)
        continue
      }
      await removeWorktreeFully(deps, { ...target, force: false })
      report.removed.push(target.path)
    } catch (reason: unknown) {
      report.failed.push({ path: target.path, message: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  return report
}
