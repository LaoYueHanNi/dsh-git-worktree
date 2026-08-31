import { describe, expect, it, vi } from 'vitest'
import {
  COLLAPSED_SESSION_LIMIT, SEARCH_DEBOUNCE_MS, SEARCH_QUERY_MAX_CODE_UNITS,
  createdLabel, deriveSearchResults, hoverTimeLabel, relativeTime, sanitizeSearchQuery,
  timeLabel, workspaceLabel,
} from '../src/client/sidebar-search.ts'
import { byRecency, deriveFlat, loadViewPrefs, saveViewPrefs, VIEW_STORAGE_KEY } from '../src/client/sidebar-groups.ts'
import type { SessionLike, SessionListLike, WorkspaceLike } from '../src/client/sidebar-groups.ts'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

function session(partial: Partial<SessionLike> & Pick<SessionLike, 'id'>): SessionLike {
  return {
    displayTitle: partial.displayTitle ?? partial.id,
    blank: partial.blank ?? false,
    ...partial,
  }
}

function list(rows: SessionLike[], current?: string): SessionListLike {
  const byId: Record<string, SessionLike> = {}
  for (const row of rows) byId[row.id] = row
  return { ids: rows.map(row => row.id), byId, current, phase: 'ready' }
}

function ws(workspaceId: string, title: string, sessionIds: string[]): WorkspaceLike {
  return { workspaceId, path: `E:\\${title}`, title, sessionIds }
}

describe('relativeTime buckets', () => {
  const now = 1_000_000_000_000

  it('answers now under one minute (including the 0 and 59999 ms edges)', () => {
    expect(relativeTime(now, now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(now - (MIN - 1), now)).toEqual({ unit: 'now', n: 0 })
  })

  it('answers minutes from 1 min inclusive to 1 hour exclusive', () => {
    expect(relativeTime(now - MIN, now)).toEqual({ unit: 'minutes', n: 1 })
    expect(relativeTime(now - (HOUR - 1), now)).toEqual({ unit: 'minutes', n: 59 })
  })

  it('answers hours from 1 hour inclusive to 1 day exclusive', () => {
    expect(relativeTime(now - HOUR, now)).toEqual({ unit: 'hours', n: 1 })
    expect(relativeTime(now - (DAY - 1), now)).toEqual({ unit: 'hours', n: 23 })
  })

  it('answers days from 1 day inclusive to 30 days exclusive', () => {
    expect(relativeTime(now - DAY, now)).toEqual({ unit: 'days', n: 1 })
    expect(relativeTime(now - (30 * DAY - 1), now)).toEqual({ unit: 'days', n: 29 })
  })

  it('answers months from 30 days inclusive to 365 days exclusive', () => {
    expect(relativeTime(now - 30 * DAY, now)).toEqual({ unit: 'months', n: 1 })
    expect(relativeTime(now - (365 * DAY - 1), now)).toEqual({ unit: 'months', n: 12 })
  })

  it('answers years from 365 days inclusive', () => {
    expect(relativeTime(now - 365 * DAY, now)).toEqual({ unit: 'years', n: 1 })
    expect(relativeTime(now - 800 * DAY, now)).toEqual({ unit: 'years', n: 2 })
  })

  it('clamps future timestamps to now rather than going negative', () => {
    expect(relativeTime(now + HOUR, now)).toEqual({ unit: 'now', n: 0 })
  })
})

describe('time / hover / created labels', () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'time.now') return 'now'
    if (key === 'time.minutes') return `${String(params?.n)}min`
    if (key === 'time.hours') return `${String(params?.n)}h`
    if (key === 'time.ago') return `${String(params?.t)} ago`
    if (key === 'date.ymd') return `${String(params?.y)}-${String(params?.m)}-${String(params?.d)}`
    if (key === 'hover.created') return `Created ${String(params?.time)}`
    return key
  }
  const now = Date.UTC(2026, 7, 31, 12, 0, 0)

  it('keeps the now bucket bare and wraps distances in the ago template', () => {
    expect(timeLabel(now, now, t)).toBe('now')
    expect(hoverTimeLabel(now, now, t)).toBe('now')
    expect(timeLabel(now - 5 * MIN, now, t)).toBe('5min')
    expect(hoverTimeLabel(now - 5 * MIN, now, t)).toBe('5min ago')
    expect(timeLabel(now - 3 * HOUR, now, t)).toBe('3h')
  })

  it('formats created time through the dictionary date template', () => {
    const created = Date.UTC(2026, 0, 2, 3, 4, 0)
    // createdLabel uses local Date getters; pin the timezone-independent pad of minutes.
    const label = createdLabel(created, t)
    expect(label.startsWith('Created 2026-')).toBe(true)
    expect(label).toMatch(/Created \d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}/)
  })
})

describe('sanitizeSearchQuery', () => {
  it('strips NULs and passes through short queries', () => {
    expect(sanitizeSearchQuery('a\0b')).toBe('ab')
    expect(sanitizeSearchQuery('hello')).toBe('hello')
  })

  it('caps at 500 UTF-16 code units without splitting a surrogate pair', () => {
    expect(SEARCH_QUERY_MAX_CODE_UNITS).toBe(500)
    const body = 'x'.repeat(499)
    // Grinning face U+1F600 is one Unicode scalar / two UTF-16 code units.
    const withPair = `${body}\uD83D\uDE00`
    expect(withPair.length).toBe(501)
    // Cutting at 500 would split the pair; the sanitizer backs up one unit.
    expect(sanitizeSearchQuery(withPair)).toBe(body)
    const exact = 'y'.repeat(500)
    expect(sanitizeSearchQuery(exact).length).toBe(500)
    const over = 'z'.repeat(520)
    expect(sanitizeSearchQuery(over).length).toBe(500)
  })
})

describe('workspaceLabel', () => {
  it('answers basename for both separators and Ungrouped for empty cwd', () => {
    expect(workspaceLabel(undefined)).toBe('Ungrouped')
    expect(workspaceLabel('')).toBe('Ungrouped')
    expect(workspaceLabel('E:\\Documents\\repo')).toBe('repo')
    expect(workspaceLabel('/home/me/repo/')).toBe('repo')
  })
})

describe('deriveSearchResults', () => {
  const workspaces = [ws('w1', 'alpha', ['s1', 's2']), ws('w2', 'beta', ['s3'])]
  const sessions = list([
    session({ id: 's1', displayTitle: 'Fix search', updatedAt: 30 }),
    session({ id: 's2', displayTitle: 'Other', updatedAt: 20, blank: true }),
    session({ id: 's3', displayTitle: 'Unrelated', updatedAt: 10 }),
    session({ id: 's4', displayTitle: 'Content only', updatedAt: 5, cwd: 'E:\\orphan' }),
  ], 's1')

  it('matches local title and workspace-name substrings, newest first, and excludes blanks', () => {
    const result = deriveSearchResults(sessions, workspaces, 'search', [], { items: [], hasMore: false }, 20)
    expect(result.items.map(item => item.id)).toEqual(['s1'])
    const byWorkspace = deriveSearchResults(sessions, workspaces, 'alpha', [], { items: [], hasMore: false }, 20)
    expect(byWorkspace.items.map(item => item.id)).toEqual(['s1'])
  })

  it('merges content hits after local rows, attaching snippets, and de-duplicates', () => {
    const result = deriveSearchResults(
      sessions, workspaces, 'search', [],
      { items: [{ sessionId: 's1', snippet: 'the query' }, { sessionId: 's4', snippet: 'also search' }], hasMore: false },
      20,
    )
    expect(result.items.map(item => item.id)).toEqual(['s1', 's4'])
    expect(result.items[0]?.snippet).toBe('the query')
    expect(result.items[1]?.snippet).toBe('also search')
    expect(result.items[1]?.workspace).toBe('orphan')
  })

  it('drops archived and subagent rows even when the content page names them', () => {
    const withSub = list([
      session({ id: 's1', displayTitle: 'Keep', updatedAt: 2 }),
      session({ id: 's2', displayTitle: 'Sub', updatedAt: 1, origin: 'subagent', parentId: 's1' }),
    ])
    const result = deriveSearchResults(
      withSub, [ws('w', 'repo', ['s1', 's2'])], 'keep', ['s1'],
      { items: [{ sessionId: 's2', snippet: 'nope' }], hasMore: false },
      20,
    )
    expect(result.items).toEqual([])
  })

  it('sets hasMore when the merged set exceeds the limit or the backend says so', () => {
    const many = list(Array.from({ length: 5 }, (_, i) => session({ id: `s${String(i)}`, displayTitle: `hit ${String(i)}`, updatedAt: i })))
    const capped = deriveSearchResults(many, [], 'hit', [], { items: [], hasMore: false }, 3)
    expect(capped.items).toHaveLength(3)
    expect(capped.hasMore).toBe(true)
    const flagged = deriveSearchResults(sessions, workspaces, 'search', [], { items: [], hasMore: true }, 20)
    expect(flagged.hasMore).toBe(true)
  })

  it('answers empty for a blank query', () => {
    expect(deriveSearchResults(sessions, workspaces, '   ', [], { items: [], hasMore: false }, 20)).toEqual({ items: [], hasMore: false })
  })
})

describe('byRecency / deriveFlat / view prefs', () => {
  it('sorts newest first with id as the tie-break', () => {
    const rows = [
      { id: 'b', updatedAt: 1 },
      { id: 'a', updatedAt: 1 },
      { id: 'c', updatedAt: 2 },
    ]
    expect([...rows].sort(byRecency).map(row => row.id)).toEqual(['c', 'a', 'b'])
  })

  it('deriveFlat hides archived/subagent/non-current blanks and sorts by recency', () => {
    const snapshot = list([
      session({ id: 's1', displayTitle: 'One', updatedAt: 1 }),
      session({ id: 's2', displayTitle: 'Sub', updatedAt: 9, origin: 'subagent' }),
      session({ id: 's3', displayTitle: 'Blank', updatedAt: 8, blank: true }),
      session({ id: 's4', displayTitle: 'Two', updatedAt: 3 }),
    ], 's1')
    expect(deriveFlat(snapshot, ['s4']).map(node => node.id)).toEqual(['s1'])
    expect(deriveFlat(snapshot, [], 'manual').map(node => node.id)).toEqual(['s1', 's4'])
  })

  it('round-trips view prefs through localStorage', () => {
    expect(loadViewPrefs()).toEqual({ groupBy: 'workspace', orderBy: 'updated' })
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      saveViewPrefs({ groupBy: 'flat', orderBy: 'manual' })
      expect(loadViewPrefs()).toEqual({ groupBy: 'flat', orderBy: 'manual' })
      store.set(VIEW_STORAGE_KEY, '{not json')
      expect(loadViewPrefs()).toEqual({ groupBy: 'workspace', orderBy: 'updated' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('constants', () => {
  it('keeps the native debounce / overflow / query-cap numbers', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(250)
    expect(COLLAPSED_SESSION_LIMIT).toBe(5)
    expect(SEARCH_QUERY_MAX_CODE_UNITS).toBe(500)
  })
})
