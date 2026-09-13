/**
 * The worktree manager's display grouping: scan entries under their
 * repository, unrecognized directories trailing as their own group. Pure
 * data — the modal only renders what this returns, and the unit tests read
 * it without pulling the component's CSS chain.
 *
 * @module git-worktree/client/scan-groups
 */

import type { WorktreeScanEntry } from '../wire.ts'

/** One display group: `repoName` names the repository, or null = the
 * unrecognized (non-git) group, always ordered last. */
export interface ScanGroup {
  readonly repoName: string | null
  readonly entries: readonly WorktreeScanEntry[]
}

/** Group the scan for display: repositories alphabetical, rows within a
 * group by branch name, both numeric-aware so `feat/v2` sorts past
 * `feat/v10`. Grouping is display-order only — the removal flows address
 * rows by path. */
export function groupScanEntries(entries: readonly WorktreeScanEntry[]): ScanGroup[] {
  const byRepo = new Map<string, WorktreeScanEntry[]>()
  const orphans: WorktreeScanEntry[] = []
  for (const entry of entries) {
    if (entry.repoName === null) {
      orphans.push(entry)
      continue
    }
    const list = byRepo.get(entry.repoName)
    if (list === undefined) byRepo.set(entry.repoName, [entry])
    else list.push(entry)
  }
  const cmp = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
  const groups = [...byRepo.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([repoName, groupEntries]) => ({
      repoName,
      entries: groupEntries.slice().sort((a, b) => cmp(a.branch ?? '', b.branch ?? '')),
    }))
  return orphans.length > 0 ? [...groups, { repoName: null, entries: orphans }] : groups
}
