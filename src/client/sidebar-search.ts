/**
 * Pure search / relative-time helpers transplanted from the native workspace
 * browser (`dsh-client-ui-workspace` lib/client.js). No React — the seat
 * component feeds snapshots and localizes the structured buckets.
 *
 * @module git-worktree/client/sidebar-search
 */

import {
  byRecency, indexSubagentRunning, sessionNode, sessionTitle,
  type SessionLike, type SessionListLike, type SessionNode, type WorkspaceLike,
} from './sidebar-groups.ts'

/** Pause between the latest keystroke and a Host content-search request. */
export const SEARCH_DEBOUNCE_MS = 250
/** Session rows visible per Workspace before the local overflow control. */
export const COLLAPSED_SESSION_LIMIT = 5
/** Column slide length: rail-search focus waits it out. */
export const EXPAND_SLIDE_MS = 300
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
export const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Display label for the ungrouped bucket row. */
export const UNGROUPED_LABEL = 'Ungrouped'

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'
/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  readonly unit: RelativeTimeUnit
  readonly n: number
}

/** One Host content-search hit (session id + excerpt). */
export interface ContentSearchHit {
  readonly sessionId: string
  readonly snippet: string
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  readonly id: string
  readonly title: string
  readonly workspace: string
  readonly running: boolean
  readonly runningSubagentCount: number
  readonly completed: boolean
  readonly pendingInteraction?: SessionLike['pendingInteraction']
  readonly snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  readonly items: readonly SearchResultNode[]
  readonly hasMore: boolean
}

/**
 * Dictionary keys the time/hover labels consult. Declaring the vocabulary
 * (instead of a bare `string`) keeps the parameter CONTRAVARIANTLY
 * compatible with any bound namespace translate (`TranslateNS<N>` accepts a
 * superset — every key here must exist in the namespace's dictionary).
 */
export type SearchTranslateKey =
  | 'time.now'
  | 'time.minutes'
  | 'time.hours'
  | 'time.days'
  | 'time.months'
  | 'time.years'
  | 'time.ago'
  | 'hover.created'
  | 'date.ymd'

/** Translate used by time/hover labels: accepts exactly the keys they consult. */
export type SearchTranslate = (key: SearchTranslateKey, params?: Record<string, unknown>) => string

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNGROUPED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/**
 * Keep controlled input and RPC payload inside the session.search wire
 * contract: strip NULs, cap at 500 UTF-16 code units, and never split a
 * surrogate pair at the cut.
 */
export function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1
  return withoutNul.slice(0, end)
}

/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
export function timeLabel(updatedAt: number, now: number, t: SearchTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  if (unit === 'now') return t('time.now')
  if (unit === 'minutes') return t('time.minutes', { n })
  if (unit === 'hours') return t('time.hours', { n })
  if (unit === 'days') return t('time.days', { n })
  if (unit === 'months') return t('time.months', { n })
  return t('time.years', { n })
}

/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare. */
export function hoverTimeLabel(updatedAt: number, now: number, t: SearchTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  if (unit === 'now') return t('time.now')
  const compact = unit === 'minutes' ? t('time.minutes', { n })
    : unit === 'hours' ? t('time.hours', { n })
      : unit === 'days' ? t('time.days', { n })
        : unit === 'months' ? t('time.months', { n })
          : t('time.years', { n })
  return t('time.ago', { t: compact })
}

/**
 * Absolute creation time through the dictionary's date template (the message
 * clock pattern): `toLocaleString` would follow the browser language, not the
 * app locale.
 */
export function createdLabel(createdAt: number, t: SearchTranslate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  return t('hover.created', {
    time: `${t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  })
}

/** Ordinary sessions are visible; among blanks, only the current one. */
function sessionVisible(session: SessionLike, current: string | undefined, archived: ReadonlySet<string>): boolean {
  return session.origin !== 'subagent' && !archived.has(session.id) && (!session.blank || session.id === current)
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 */
export function deriveSearchResults(
  list: SessionListLike,
  workspaces: readonly WorkspaceLike[],
  query: string,
  archivedSessionIds: readonly string[],
  content: { items: readonly ContentSearchHit[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentRunning(list.byId)
  const workspaceBySession = new Map<string, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionLike): string => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<string, ContentSearchHit>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }
  const local: SessionLike[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary)
  }
  local.sort((a, b) => byRecency(
    { id: a.id, updatedAt: a.updatedAt ?? 0 },
    { id: b.id, updatedAt: b.updatedAt ?? 0 },
  ))
  const ordered: SessionLike[] = []
  const included = new Set<string>()
  const include = (summary: SessionLike): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }
  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      const node = sessionNode(summary, descendants)
      return {
        id: node.id,
        title: node.title,
        workspace: labelOf(summary),
        running: node.running,
        runningSubagentCount: node.runningSubagentCount,
        completed: node.completed,
        ...summary.pendingInteraction === undefined ? {} : { pendingInteraction: summary.pendingInteraction },
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/** Re-export SessionNode so search rows share the session status shape. */
export type { SessionNode }
