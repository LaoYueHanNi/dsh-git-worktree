import { describe, expect, it, vi } from 'vitest'
import { readPruneHistory, recordPruneRun, type PruneRunEntry } from '../src/client/prune-history.ts'
import { freshestUpdatedAt } from '../src/client/worktree-prune.ts'
import { groupScanEntries } from '../src/client/scan-groups.ts'
import type { WorktreeScanEntry } from '../src/wire.ts'

describe('freshestUpdatedAt', () => {
  const summary = (updatedAt: number, over: { blank?: boolean; origin?: string } = {}) => ({ updatedAt, ...over })

  it('takes the max updatedAt over qualifying sessions', () => {
    expect(freshestUpdatedAt([summary(100), summary(300), summary(200)])).toBe(300)
  })

  it('ignores blank and subagent rows', () => {
    expect(freshestUpdatedAt([summary(300, { blank: true }), summary(100, { origin: 'subagent' }), summary(200)])).toBe(200)
  })

  it('answers 0 when nothing qualifies (least active in the room)', () => {
    expect(freshestUpdatedAt([])).toBe(0)
    expect(freshestUpdatedAt([undefined, summary(50, { blank: true })])).toBe(0)
  })
})

describe('groupScanEntries', () => {
  const entry = (path: string, repoName: string | null, branch: string | null): WorktreeScanEntry =>
    ({ path, repoName, branch } as WorktreeScanEntry)

  it('groups by repository, alphabetical, rows by branch name', () => {
    const groups = groupScanEntries([
      entry('/wt/r-b/x', 'r-b', 'main'),
      entry('/wt/r-a/v10', 'r-a', 'feat/v10'),
      entry('/wt/r-a/v2', 'r-a', 'feat/v2'),
    ])
    expect(groups.map(g => g.repoName)).toEqual(['r-a', 'r-b'])
    expect(groups[0]?.entries.map(e => e.branch)).toEqual(['feat/v2', 'feat/v10'])
  })

  it('trails the unrecognized directories as their own group', () => {
    const groups = groupScanEntries([
      entry('/wt/leftover', null, null),
      entry('/wt/r-a/x', 'r-a', 'main'),
    ])
    expect(groups.map(g => g.repoName)).toEqual(['r-a', null])
    expect(groups[1]?.entries).toHaveLength(1)
  })

  it('answers no orphan group when every entry is recognized', () => {
    const groups = groupScanEntries([entry('/wt/r-a/x', 'r-a', 'main')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.repoName).toBe('r-a')
  })
})

describe('prune history storage', () => {
  const run = (at: number, removed: string[] = []): PruneRunEntry => ({
    at,
    removed: removed.map(path => ({ path, repoName: 'repo', branch: 'b' })),
    skippedDirty: [],
    failed: [],
  })

  it('round-trips through localStorage and tolerates its absence', () => {
    // No localStorage in the node environment: reads answer [] and writes no-op.
    expect(readPruneHistory()).toEqual([])
    expect(() => recordPruneRun(run(1))).not.toThrow()

    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      recordPruneRun(run(1, ['/wt/a']))
      recordPruneRun(run(2, ['/wt/b']))
      const history = readPruneHistory()
      expect(history.map(entry => entry.at)).toEqual([2, 1])
      expect(history[0]?.removed[0]?.repoName).toBe('repo')

      store.set('git-worktree:prune-history', '{not json')
      expect(readPruneHistory()).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps only the newest runs', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      for (let at = 1; at <= 25; at += 1) recordPruneRun(run(at))
      const history = readPruneHistory()
      expect(history).toHaveLength(20)
      expect(history[0]?.at).toBe(25)
      expect(history[19]?.at).toBe(6)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // The settings card reads run.removed.length straight into its render, so
  // a foreign payload that survives the read takes the whole card down.
  it('drops entries that are not shaped like a run, keeping the good ones', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      const good = run(7, ['/wt/a'])
      store.set('git-worktree:prune-history', JSON.stringify([
        1,
        null,
        'run',
        { at: 'yesterday', removed: [], skippedDirty: [], failed: [] },
        { at: 3, removed: [], skippedDirty: [] },
        { at: 4, removed: 'none', skippedDirty: [], failed: [] },
        good,
      ]))
      const history = readPruneHistory()
      expect(history).toHaveLength(1)
      expect(history[0]?.at).toBe(7)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a non-array payload as no history', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      store.set('git-worktree:prune-history', JSON.stringify({ at: 1 }))
      expect(readPruneHistory()).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
