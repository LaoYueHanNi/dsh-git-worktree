/**
 * The worktree manager's display grouping: scan entries under their
 * repository AND storage origin — project-internal layout first (the current
 * default), the legacy central location behind it (its worktrees stay put
 * and keep working, the badge says why they look different), unrecognized
 * directories trailing as their own group. Pure data — the modal only
 * renders what this returns, and the unit tests read it without pulling the
 * component's CSS chain.
 *
 * @module git-worktree/client/scan-groups
 */

import type { WorktreeScanEntry } from '../wire.ts'

/** One display group: `repoName` names the repository; null = the
 * unrecognized (non-git) group, always ordered last. `source` names which
 * storage location the group's rows live in ('orphans' for the trailing
 * group, where rows may come from either location). */
export interface ScanGroup {
  readonly repoName: string | null
  readonly source: 'legacy' | 'project' | 'orphans'
  readonly entries: readonly WorktreeScanEntry[]
}

/** Group the scan for display: project groups before legacy groups (same
 * repo can appear under both), repositories alphabetical within a source,
 * rows within a group by branch name, all numeric-aware so `feat/v2` sorts
 * past `feat/v10`. Grouping is display-order only — the removal flows
 * address rows by path. */
export function groupScanEntries(entries: readonly WorktreeScanEntry[]): ScanGroup[] {
  const byKey = new Map<string, { source: 'legacy' | 'project'; repoName: string; list: WorktreeScanEntry[] }>()
  const orphans: WorktreeScanEntry[] = []
  for (const entry of entries) {
    if (entry.repoName === null) {
      orphans.push(entry)
      continue
    }
    const key = `${entry.source}\u0000${entry.repoName}`
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, { source: entry.source, repoName: entry.repoName, list: [entry] })
    else bucket.list.push(entry)
  }
  const cmp = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
  const groups = [...byKey.values()]
    .sort((a, b) => a.source === b.source
      ? cmp(a.repoName, b.repoName)
      : a.source === 'project' ? -1 : 1)
    .map(({ source, repoName, list }) => ({
      repoName,
      source,
      entries: list.slice().sort((a, b) => cmp(a.branch ?? '', b.branch ?? '')),
    }))
  return orphans.length > 0 ? [...groups, { repoName: null, source: 'orphans' as const, entries: orphans }] : groups
}
