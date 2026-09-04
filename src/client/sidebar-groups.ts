/**
 * Pure derivation of the grouped sidebar list: which workspaces form one
 * repository group, what each member row is called, and which sessions a row
 * shows. No React, no store, no network — the component layer feeds it
 * snapshots (workspace items, the /group facts, the session list) and renders
 * what comes out. Grouping is fully DERIVED from the workspace registry plus
 * on-disk git facts: no relationship is stored anywhere.
 *
 * Shapes are structural minimums (not the runtime service types) so the
 * derivation unit-tests without a client runtime.
 *
 * @module git-worktree/client/sidebar-groups
 */

import type { WorkspaceGitFacts } from '../wire.ts'

/** User interaction currently blocking a session (sidebar amber-dot state). */
export type PendingInteraction = 'approval' | 'plan-review' | 'question'

/** The workspace facts the derivation needs (a subset of WorkspaceView). */
export interface WorkspaceLike {
  readonly workspaceId: string
  /** Absolute registered directory — the /group probe key. */
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  /** ISO-8601 creation instant (HoverCard); absent while the snapshot omits it. */
  readonly createdAt?: string
}

/** The session facts the visible-row rule needs (a subset of SessionSummary). */
export interface SessionLike {
  readonly id: string
  readonly displayTitle: string
  readonly blank: boolean
  /** `'subagent'` rows never show in the browser (native rule). */
  readonly origin?: string
  /** Parent of a subagent row; feeds descendant running-count. */
  readonly parentId?: string
  /** Directory the session is bound to (search workspace-label fallback). */
  readonly cwd?: string
  /** Whether the session is running (the sidebar's active dot). */
  readonly running?: boolean
  /** Finished while unopened (the sidebar's completed dot); absent = false. */
  readonly completed?: boolean
  /** Epoch ms of last activity (relative time + recency sort). */
  readonly updatedAt?: number
  /** User interaction currently blocking this session. */
  readonly pendingInteraction?: PendingInteraction
}

/** Minimal session-list snapshot the visibility rule reads. */
export interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionLike | undefined>>
  readonly current: string | undefined
  /** Arrival lifecycle; `ready` means an empty list is truly empty. */
  readonly phase?: string
}

/** One top-level session row in a group or the flat list (native SessionNode). */
export interface SessionNode {
  readonly id: string
  readonly title: string
  readonly blank: boolean
  readonly running: boolean
  readonly runningSubagentCount: number
  readonly completed: boolean
  readonly updatedAt: number
  readonly pendingInteraction?: PendingInteraction
}

/** Descendant totals keyed by possible parent id. */
export interface SubagentRunning {
  readonly count: number
  readonly runningCount: number
}

/** Grouping mode persisted in the local view prefs. */
export type SidebarGroupBy = 'workspace' | 'flat'
/** Ordering mode persisted in the local view prefs. */
export type SidebarOrderBy = 'manual' | 'updated'

/** Browser-local view prefs (not the native `dsh.workspace.view.v5` store). */
export interface SidebarViewPrefs {
  readonly groupBy: SidebarGroupBy
  readonly orderBy: SidebarOrderBy
}

/** How one member row is labelled. */
export type MemberLabel =
  /** Plain row: single-member (degraded) or non-git workspace — native look. */
  | { readonly type: 'plain' }
  /** Main-worktree member of a multi-member group. */
  | { readonly type: 'main'; readonly branch: string | null }
  /** Linked-worktree member of a multi-member group. */
  | { readonly type: 'linked'; readonly branch: string | null }

/** One workspace row inside a group. */
export interface SidebarMember {
  readonly workspace: WorkspaceLike
  readonly label: MemberLabel
}

/** One rendered group: a repository cluster, or a single plain row. */
export interface SidebarGroup {
  /** Stable expansion-storage key: `repo:<repoRoot>` or `ws:<workspaceId>`. */
  readonly key: string
  readonly kind: 'repo' | 'single'
  /** Repository basename (repo groups only). */
  readonly repoName: string | undefined
  readonly members: readonly SidebarMember[]
}

/**
 * Derive the sidebar groups.
 *
 * Rules (the shipped design): git facts absent/null → plain single row;
 * same-`repoRoot` workspaces cluster into one repo group; inside a group the
 * main worktree leads and linked members keep registry order; a repo cluster
 * with exactly ONE member degrades to a plain row (zero visual intrusion for
 * repositories without worktrees); a group renders where its FIRST member
 * sits in the registry order (the main worktree's slot).
 * @param items - workspace list items in registry order.
 * @param facts - per-path git facts from the /group route (absent = unknown).
 * @returns groups in render order.
 */
export function deriveSidebarGroups(
  items: readonly WorkspaceLike[],
  facts: Readonly<Record<string, WorkspaceGitFacts | null>> | undefined,
): readonly SidebarGroup[] {
  // Bucket git workspaces by repoRoot; keep first-seen registry index per
  // bucket for the group's render slot, and member order inside it.
  const bucketOrder: string[] = []
  const buckets = new Map<string, { index: number; mainSeen: boolean; members: SidebarMember[] }>()
  const singles: { index: number; group: SidebarGroup }[] = []

  items.forEach((workspace, index) => {
    const pathFacts = facts?.[workspace.path]
    if (pathFacts === undefined || pathFacts === null) {
      singles.push({ index, group: singleGroup(workspace) })
      return
    }
    const bucketKey = `repo:${pathFacts.repoRoot}`
    let bucket = buckets.get(bucketKey)
    if (bucket === undefined) {
      bucket = { index, mainSeen: false, members: [] }
      buckets.set(bucketKey, bucket)
      bucketOrder.push(bucketKey)
    }
    bucket.members.push({
      workspace,
      label: pathFacts.main
        ? { type: 'main', branch: pathFacts.branch }
        : { type: 'linked', branch: pathFacts.branch },
    })
    if (pathFacts.main) bucket.mainSeen = true
  })

  // Materialize repo groups: multi-member keep the cluster (main leads);
  // single-member degrade to plain. Re-derive per-bucket main ordering here
  // where every member is known.
  const repoGroups = new Map<string, SidebarGroup>()
  for (const key of bucketOrder) {
    const bucket = buckets.get(key)
    if (bucket === undefined) continue
    const ordered = bucket.mainSeen
      ? [...bucket.members].sort((a, b) => Number(b.label.type === 'main') - Number(a.label.type === 'main'))
      : bucket.members
    const first = ordered[0]
    // A bucket exists only because a member created it, so `first` always
    // resolves; the guard merely satisfies noUncheckedIndexedAccess.
    if (first === undefined) continue
    const repoName = facts?.[first.workspace.path]?.repoName ?? first.workspace.title
    if (ordered.length === 1) {
      // Visual still degrades to a single row (no repo header). A linked
      // worktree keeps its linked label so the remove-worktree menu stays;
      // wiping it to `plain` hid that action on a freshly created worktree
      // (often the only registered checkout of that repo, or the only one
      // whose facts have landed).
      if (first.label.type === 'linked') {
        singles.push({
          index: bucket.index,
          group: {
            key: `ws:${first.workspace.workspaceId}`,
            kind: 'single',
            repoName: undefined,
            members: [first],
          },
        })
      } else {
        singles.push({ index: bucket.index, group: singleGroup(first.workspace) })
      }
      continue
    }
    repoGroups.set(key, { key, kind: 'repo', repoName, members: ordered })
  }

  // Render order: interleave by the slot each group claimed.
  const slots: { index: number; group: SidebarGroup }[] = [
    ...singles,
    ...[...repoGroups.values()].map(group => {
      const bucket = buckets.get(group.key)
      return { index: bucket?.index ?? Number.MAX_SAFE_INTEGER, group }
    }),
  ]
  slots.sort((a, b) => a.index - b.index)
  return slots.map(slot => slot.group)
}

/** A plain single-row group for one workspace. */
function singleGroup(workspace: WorkspaceLike): SidebarGroup {
  return {
    key: `ws:${workspace.workspaceId}`,
    kind: 'single',
    repoName: undefined,
    members: [{ workspace, label: { type: 'plain' } }],
  }
}

/**
 * Session ids a member row shows, in the workspace's stored order — the
 * native browser's visibility rule: archived hidden everywhere, subagent
 * rows never listed, and a blank row visible only while it IS the current
 * selection (a blank is the provisional New Session row).
 * @param workspace - the member's workspace.
 * @param sessions - session list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns visible session ids in stored order.
 */
export function visibleSessionIds(
  workspace: WorkspaceLike,
  sessions: SessionListLike,
  archivedSessionIds: readonly string[],
): readonly string[] {
  const archived = new Set(archivedSessionIds)
  const visible: string[] = []
  for (const sessionId of workspace.sessionIds) {
    const summary = sessions.byId[sessionId]
    if (summary === undefined) continue
    if (summary.origin === 'subagent') continue
    if (archived.has(sessionId)) continue
    if (summary.blank && sessionId !== sessions.current) continue
    visible.push(sessionId)
  }
  return visible
}

/** localStorage key of the sidebar expansion map (browser-local only). */
export const EXPAND_STORAGE_KEY = 'dsh-git-worktree.sidebar.expand'

/** Read the persisted expansion map; unreadable/absent answers {}. */
export function loadExpandState(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(EXPAND_STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the expansion map; write failures (quota, privacy mode) stay silent. */
export function saveExpandState(state: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A collapsed group is a fine failure mode.
  }
}

/** localStorage key of grouping/order prefs (browser-local; P3 may graduate to store v5). */
export const VIEW_STORAGE_KEY = 'dsh-git-worktree.sidebar.view'

const DEFAULT_VIEW_PREFS: SidebarViewPrefs = { groupBy: 'workspace', orderBy: 'updated' }

/** Read persisted view prefs; unreadable/absent answers native defaults. */
export function loadViewPrefs(): SidebarViewPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_VIEW_PREFS
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY)
    if (raw === null) return DEFAULT_VIEW_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_VIEW_PREFS
    const record = parsed as Record<string, unknown>
    const groupBy = record.groupBy === 'flat' || record.groupBy === 'workspace' ? record.groupBy : DEFAULT_VIEW_PREFS.groupBy
    const orderBy = record.orderBy === 'manual' || record.orderBy === 'updated' ? record.orderBy : DEFAULT_VIEW_PREFS.orderBy
    return { groupBy, orderBy }
  } catch {
    return DEFAULT_VIEW_PREFS
  }
}

/** Persist view prefs; write failures stay silent. */
export function saveViewPrefs(prefs: SidebarViewPrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Default grouping is a fine failure mode.
  }
}

/** localStorage key of the grouping switch's last-known value (browser-local). */
export const GROUP_BOOT_STORAGE_KEY = 'dsh-git-worktree.sidebar.groupSidebar'

/**
 * Read the grouping switch's last-known value. The seat mounts from this on
 * startup so the sidebar renders grouped IMMEDIATELY, without waiting for the
 * settings document to cross from the Host — the settings scope is the
 * authority and corrects a stale value once it lands. undefined = no record
 * (first visit; the composition default "on" is used).
 */
export function loadGroupSidebarBoot(): boolean | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(GROUP_BOOT_STORAGE_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
    return undefined
  } catch {
    return undefined
  }
}

/** Persist the grouping switch's last-known value; write failures stay silent. */
export function saveGroupSidebarBoot(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(GROUP_BOOT_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // A missed cache write costs one startup flash, nothing more.
  }
}

/** localStorage key of the last successful /group facts batch (browser-local). */
export const FACTS_STORAGE_KEY = 'dsh-git-worktree.sidebar.facts.v1'

/** One cached facts batch: the path signature it answered plus the facts. */
export interface FactsCacheEntry {
  /** Sorted-path signature the facts belong to (mismatch = stale). */
  signature: string
  /** Per-path git facts; null = outside any git repository. */
  facts: Readonly<Record<string, WorkspaceGitFacts | null>>
}

/** Parse one WorkspaceGitFacts value; undefined = malformed. */
function parseWorkspaceGitFacts(value: unknown): WorkspaceGitFacts | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.repoRoot !== 'string' || record.repoRoot === '') return undefined
  if (typeof record.repoName !== 'string') return undefined
  if (record.branch !== null && typeof record.branch !== 'string') return undefined
  if (typeof record.main !== 'boolean') return undefined
  return {
    repoRoot: record.repoRoot,
    repoName: record.repoName,
    branch: record.branch,
    main: record.main,
  }
}

/** Parse a facts map; any malformed entry discards the whole batch. */
function parseFactsRecord(value: unknown): Readonly<Record<string, WorkspaceGitFacts | null>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const out: Record<string, WorkspaceGitFacts | null> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null) {
      out[key] = null
      continue
    }
    const parsed = parseWorkspaceGitFacts(entry)
    if (parsed === undefined) return null
    out[key] = parsed
  }
  return out
}

/**
 * Read the last successful /group facts batch. The sidebar consults this
 * whenever the workspace path signature is known (including the frame the
 * pending-empty baseline becomes the real list), so a page refresh never
 * flashes the degraded flat list while git probes run; the fresh probe
 * overwrites both the view and this cache. A poisoned entry (wrong value
 * shape) discards the whole batch rather than grouping under `repo:undefined`.
 */
export function loadFactsCache(): FactsCacheEntry | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(FACTS_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.signature !== 'string') return null
    const facts = parseFactsRecord(record.facts)
    if (facts === null) return null
    return { signature: record.signature, facts }
  } catch {
    return null
  }
}

/**
 * Pick the facts batch that belongs to `signature`. Live (in-memory) hits
 * win; otherwise a matching cache batch. The grouped tree must paint the
 * moment the workspace path set is known — not only at `useState` init,
 * when the list is still the pending empty snapshot (signature `""`).
 *
 * A newly added workspace changes the signature. Exact-match-only would
 * drop every cached fact until `/group` returns, flattening the tree and
 * hiding “删除工作树” on the new linked row. Overlapping batches reuse
 * facts for paths still present; unknown new paths stay absent (plain)
 * until the probe lands.
 */
export function factsForSignature(
  signature: string,
  live: FactsCacheEntry | null,
  cached: FactsCacheEntry | null,
): FactsCacheEntry | null {
  if (live !== null && live.signature === signature) return live
  if (cached !== null && cached.signature === signature) return cached
  if (live !== null) {
    const facts = projectFacts(live.facts, signature)
    if (facts !== undefined) return { signature, facts }
  }
  if (cached !== null) {
    const facts = projectFacts(cached.facts, signature)
    if (facts !== undefined) return { signature, facts }
  }
  return null
}

/** Facts for paths that exist in both the batch and the current signature. */
function projectFacts(
  facts: Readonly<Record<string, WorkspaceGitFacts | null>>,
  signature: string,
): Readonly<Record<string, WorkspaceGitFacts | null>> | undefined {
  const paths = signature.split('\n').filter(path => path !== '')
  if (paths.length === 0) return undefined
  const out: Record<string, WorkspaceGitFacts | null> = {}
  let hit = 0
  for (const path of paths) {
    if (!Object.hasOwn(facts, path)) continue
    out[path] = facts[path] ?? null
    hit += 1
  }
  return hit === 0 ? undefined : out
}

/** Persist one /group facts batch; write failures (quota, privacy mode) stay silent. */
export function saveFactsCache(entry: FactsCacheEntry): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(FACTS_STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // A missed cache write costs one startup flash, nothing more.
  }
}

/** Recency comparator: newest first, id as the deterministic tiebreak. */
export function byRecency(a: { id: string; updatedAt: number }, b: { id: string; updatedAt: number }): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Index running/total subagent descendants under each ancestor reached through
 * an uninterrupted subagent-origin chain (ordinary forks terminate propagation).
 * Mirrors `indexSubagentDescendants` without importing the runtime bundle.
 */
export function indexSubagentRunning(
  byId: Readonly<Record<string, SessionLike | undefined>>,
): ReadonlyMap<string, SubagentRunning> {
  const out = new Map<string, { count: number; runningCount: number }>()
  const bump = (id: string, running: boolean): void => {
    const cur = out.get(id) ?? { count: 0, runningCount: 0 }
    out.set(id, { count: cur.count + 1, runningCount: cur.runningCount + (running ? 1 : 0) })
  }
  for (const summary of Object.values(byId)) {
    if (summary === undefined || summary.origin !== 'subagent') continue
    const running = summary.running === true
    const seen = new Set<string>()
    let parentId = summary.parentId
    while (parentId !== undefined && parentId !== '' && !seen.has(parentId)) {
      seen.add(parentId)
      bump(parentId, running)
      const parent = byId[parentId]
      if (parent === undefined || parent.origin !== 'subagent') break
      parentId = parent.parentId
    }
  }
  return out
}

/** A blank session's canonical title never enters search; the renderer localizes the label. */
export function sessionTitle(session: SessionLike): string {
  return session.blank ? 'New Session' : session.displayTitle
}

/** Project a list-row summary into a renderable session node. */
export function sessionNode(
  session: SessionLike,
  descendants: ReadonlyMap<string, SubagentRunning>,
): SessionNode {
  return {
    id: session.id,
    title: sessionTitle(session),
    blank: session.blank,
    running: session.running === true,
    runningSubagentCount: descendants.get(session.id)?.runningCount ?? 0,
    completed: session.completed === true,
    updatedAt: session.updatedAt ?? 0,
    ...session.pendingInteraction === undefined ? {} : { pendingInteraction: session.pendingInteraction },
  }
}

/** Visible session ids, optionally newest-first when `orderBy` is `updated`. */
export function orderedVisibleSessionIds(
  workspace: WorkspaceLike,
  sessions: SessionListLike,
  archivedSessionIds: readonly string[],
  orderBy: SidebarOrderBy,
): readonly string[] {
  const ids = visibleSessionIds(workspace, sessions, archivedSessionIds)
  if (orderBy !== 'updated') return ids
  return [...ids].sort((a, b) => {
    const left = sessions.byId[a]
    const right = sessions.byId[b]
    return byRecency(
      { id: a, updatedAt: left?.updatedAt ?? Number.NEGATIVE_INFINITY },
      { id: b, updatedAt: right?.updatedAt ?? Number.NEGATIVE_INFINITY },
    )
  })
}

/**
 * Flat session list ("In one list"): every visible session as a top-level
 * row. `updated` is newest-first; `manual` keeps the session-list stored order.
 */
export function deriveFlat(
  list: SessionListLike,
  archivedSessionIds: readonly string[],
  orderBy: SidebarOrderBy = 'updated',
): readonly SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentRunning(list.byId)
  const rows: SessionLike[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    if (summary.origin === 'subagent') continue
    if (archived.has(id)) continue
    if (summary.blank && id !== list.current) continue
    rows.push(summary)
  }
  if (orderBy === 'updated') {
    rows.sort((a, b) => byRecency(
      { id: a.id, updatedAt: a.updatedAt ?? 0 },
      { id: b.id, updatedAt: b.updatedAt ?? 0 },
    ))
  }
  return rows.map(session => sessionNode(session, descendants))
}

/** One virtual directory cluster of stray (unaccounted) sessions. */
export interface StrayGroup {
  readonly kind: 'stray'
  /** Stable expansion key: `stray:<lowercased cwd>` (`stray:?` when unknown). */
  readonly key: string
  /** The sessions' cwd verbatim (first-seen casing); '' when a header has none. */
  readonly path: string
  /** Title of the registered workspace whose path matches (case-insensitive);
   * undefined = no registered workspace holds this directory. */
  readonly belongsTo: string | undefined
  /** Visible stray sessions of the directory, in session-list order. */
  readonly sessions: readonly SessionLike[]
}

/**
 * Derive the stray-session clusters: sessions no workspace account holds
 * (a deleted-then-recreated registration's leftovers, or history that
 * appeared after first-boot grouping), clustered by their header cwd into
 * VIRTUAL directory groups. The same visibility rule as everywhere else
 * applies (archived hidden, subagent rows never listed, a blank visible
 * only while it IS the current selection — deleting the current session's
 * workspace registration must not make it vanish).
 *
 * Matching against registered workspace paths is case-insensitive
 * (NTFS): one directory must never split into two clusters because of
 * casing drift between a session header and the registry's realpath.
 * @param items - workspace list items (their `sessionIds` projection IS the
 * accounting; the registry guarantees one record per canonical path).
 * @param sessions - session list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns stray groups in first-appearance order; empty when nothing is loose.
 */
export function deriveStrayGroups(
  items: readonly WorkspaceLike[],
  sessions: SessionListLike,
  archivedSessionIds: readonly string[],
): readonly StrayGroup[] {
  const accounted = new Set(items.flatMap(workspace => workspace.sessionIds))
  const registered = new Map<string, string>()
  for (const workspace of items) {
    const key = workspace.path.toLowerCase()
    if (!registered.has(key)) registered.set(key, workspace.title)
  }
  const archived = new Set(archivedSessionIds)
  const clusters = new Map<string, StrayGroup>()
  for (const id of sessions.ids) {
    if (accounted.has(id)) continue
    const summary = sessions.byId[id]
    if (summary === undefined) continue
    if (summary.origin === 'subagent') continue
    if (archived.has(id)) continue
    if (summary.blank && id !== sessions.current) continue
    const path = summary.cwd ?? ''
    const key = `stray:${path === '' ? '?' : path.toLowerCase()}`
    const existing = clusters.get(key)
    if (existing === undefined) {
      clusters.set(key, {
        kind: 'stray',
        key,
        path,
        belongsTo: path === '' ? undefined : registered.get(path.toLowerCase()),
        sessions: [summary],
      })
    } else {
      clusters.set(key, { ...existing, sessions: [...existing.sessions, summary] })
    }
  }
  return [...clusters.values()]
}
