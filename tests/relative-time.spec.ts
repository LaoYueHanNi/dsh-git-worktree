import { describe, expect, it } from 'vitest'
import { relativeTime, timeLabel } from '../src/client/relative-time.ts'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

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

describe('timeLabel', () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'time.now') return 'now'
    if (key === 'time.minutes') return `${String(params?.n)}min`
    if (key === 'time.hours') return `${String(params?.n)}h`
    return key
  }
  const now = Date.UTC(2026, 7, 31, 12, 0, 0)

  it('keeps the now bucket bare and renders each distance bucket', () => {
    expect(timeLabel(now, now, t)).toBe('now')
    expect(timeLabel(now - 5 * MIN, now, t)).toBe('5min')
    expect(timeLabel(now - 3 * HOUR, now, t)).toBe('3h')
  })
})
