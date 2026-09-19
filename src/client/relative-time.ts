/**
 * Compact relative time as a structured bucket the renderer localizes —
 * the prune history rows and the worktree manager's last-use column share
 * these so the two surfaces cannot drift apart. No React, no imports.
 *
 * @module git-worktree/client/relative-time
 */

/** Relative-time bucket of a trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'
/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  readonly unit: RelativeTimeUnit
  readonly n: number
}

/**
 * Dictionary keys the time label consults. Declaring the vocabulary (instead
 * of a bare `string`) keeps the parameter CONTRAVARIANTLY compatible with any
 * bound namespace translate (`TranslateNS<N>` accepts a superset — every key
 * here must exist in the namespace's dictionary).
 */
export type TimeTranslateKey =
  | 'time.now'
  | 'time.minutes'
  | 'time.hours'
  | 'time.days'
  | 'time.months'
  | 'time.years'

/** Translate used by the time label: accepts exactly the keys it consults. */
export type TimeTranslate = (key: TimeTranslateKey, params?: Record<string, unknown>) => string

/**
 * Compact relative time for trailing labels, as a structured bucket the
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
export function timeLabel(updatedAt: number, now: number, t: TimeTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  if (unit === 'now') return t('time.now')
  if (unit === 'minutes') return t('time.minutes', { n })
  if (unit === 'hours') return t('time.hours', { n })
  if (unit === 'days') return t('time.days', { n })
  if (unit === 'months') return t('time.months', { n })
  return t('time.years', { n })
}
