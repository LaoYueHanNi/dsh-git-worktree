import type { HistoryCommit } from '../wire.ts'

/** Keep the selection inside the filtered rows, without scanning per row. */
export function filterCommits(commits: readonly HistoryCommit[], query: string, author: string, selected: string | null): {
  visible: { item: HistoryCommit; index: number }[]
  selected: string | null
} {
  const needle = query.trim().toLocaleLowerCase()
  const visible: { item: HistoryCommit; index: number }[] = []
  let matchingSelection: string | null = null
  for (const [index, item] of commits.entries()) {
    if (author && item.author !== author) continue
    if (needle && !`${item.subject} ${item.oid}`.toLocaleLowerCase().includes(needle)) continue
    visible.push({ item, index })
    if (item.oid === selected) matchingSelection = selected
  }
  return { visible, selected: matchingSelection ?? visible[0]?.item.oid ?? null }
}

export interface GraphEdge { from: number; to: number; parent: boolean }
export interface GraphRow {
  lane: number
  incoming: boolean
  edges: GraphEdge[]
}

/** Allocate lanes over the entire loaded prefix, so appending a page never
 * changes earlier nodes. Missing parents continue to the page boundary. */
export function layoutCommits(commits: readonly Pick<HistoryCommit, 'oid' | 'parents'>[]): { rows: GraphRow[]; lanes: number } {
  const active: (string | null)[] = []
  let lanes = 1
  const rows: GraphRow[] = []
  for (const item of commits) {
    let lane = active.indexOf(item.oid)
    const incoming = lane !== -1
    if (lane === -1) {
      lane = active.indexOf(null)
      if (lane === -1) lane = active.length
      active[lane] = item.oid
    }
    const before = [...active]
    active[lane] = null
    const edges: GraphEdge[] = []
    for (const parent of new Set(item.parents)) {
      let target = active.indexOf(parent)
      if (target === -1) {
        target = active.indexOf(null)
        if (target === -1) target = active.length
        active[target] = parent
      }
      edges.push({ from: lane, to: target, parent: true })
    }
    for (let i = 0; i < before.length; i++) {
      const oid = before[i]
      if (oid !== null && oid !== undefined && oid !== item.oid) edges.push({ from: i, to: active.indexOf(oid), parent: false })
    }
    lanes = Math.max(lanes, active.length, before.length)
    while (active.length && active.at(-1) === null) active.pop()
    rows.push({ lane, incoming, edges })
  }
  return { rows, lanes }
}
