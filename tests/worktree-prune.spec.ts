import { describe, expect, it } from 'vitest'
import { planPrune, pathKey, runAutoPrune } from '../src/client/worktree-prune.ts'

describe('pathKey', () => {
  it('unifies separators and trailing slashes', () => {
    expect(pathKey('D:\\wt\\repo-main')).toBe('D:/wt/repo-main')
    expect(pathKey('D:/wt/repo-main/')).toBe('D:/wt/repo-main')
    expect(pathKey('/home/u/wt')).toBe('/home/u/wt')
  })
})

describe('planPrune', () => {
  const input = (over: Partial<Parameters<typeof planPrune>[0]> = {}): Parameters<typeof planPrune>[0] => ({
    paths: ['D:/wt/r-a', 'D:/wt/r-b', 'D:/wt/r-c', 'D:/wt/r-d'],
    activity: { 'D:/wt/r-a': 100, 'D:/wt/r-b': 300, 'D:/wt/r-c': 0, 'D:/wt/r-d': 200 },
    keep: 2,
    exclude: new Set<string>(),
    ...over,
  })

  it('deletes the overflow, least-recently-active first', () => {
    // 4 paths, keep 2 → delete 2: the never-used (r-c, activity 0) and the
    // oldest-used (r-a, activity 100) go; r-b/r-d stay.
    expect(planPrune(input())).toEqual(['D:/wt/r-c', 'D:/wt/r-a'])
  })

  it('treats a missing activity entry as the least active', () => {
    expect(planPrune(input({ activity: {} }))).toEqual(['D:/wt/r-a', 'D:/wt/r-b'])
  })

  it('deletes nothing at or under the cap', () => {
    expect(planPrune(input({ keep: 4 }))).toEqual([])
    expect(planPrune(input({ keep: 10 }))).toEqual([])
  })

  it('counts excluded paths against the cap but never selects them', () => {
    // The fresh creation (r-d) counts toward the 4, but only r-c/r-a are
    // selectable: the newest session's directory and the running ones are
    // untouchable.
    expect(planPrune(input({ exclude: new Set(['D:\\wt\\r-d']) }))).toEqual(['D:/wt/r-c', 'D:/wt/r-a'])
  })

  it('deletes from the selectable pool when exclusions shrink it below the overflow', () => {
    // keep 2, two exclusions: the overflow (2) still deletes from the two
    // remaining candidates, least-active first.
    expect(planPrune(input({ keep: 2, exclude: new Set(['D:/wt/r-a', 'D:/wt/r-c']) }))).toEqual(['D:/wt/r-d', 'D:/wt/r-b'])
    // Everything excluded: nothing is selectable, nothing is deleted.
    expect(planPrune(input({ exclude: new Set(['D:/wt/r-a', 'D:/wt/r-b', 'D:/wt/r-c', 'D:/wt/r-d']) }))).toEqual([])
  })

  it('clamps a cap under 1 to 1', () => {
    expect(planPrune(input({ keep: 0 }))).toEqual(['D:/wt/r-c', 'D:/wt/r-a', 'D:/wt/r-d'])
    expect(planPrune(input({ keep: -5 }))).toEqual(['D:/wt/r-c', 'D:/wt/r-a', 'D:/wt/r-d'])
  })

  it('breaks activity ties alphabetically for a stable order', () => {
    expect(planPrune(input({ activity: {} }))).toEqual(['D:/wt/r-a', 'D:/wt/r-b'])
  })

  it('matches excluded paths across separator spellings', () => {
    // If the separator normalization failed, r-c (activity 0) would slip
    // into the pool and be selected over r-a.
    expect(planPrune(input({ keep: 3, exclude: new Set(['D:\\wt\\r-c', 'D:\\wt\\r-d\\']) }))).toEqual(['D:/wt/r-a'])
  })
})

describe('runAutoPrune', () => {
  /** Removal flow deps recording every call. */
  function deps(over: Partial<Parameters<typeof runAutoPrune>[0]> = {}): Parameters<typeof runAutoPrune>[0] {
    return {
      inspectWorktree: async () => ({ dirty: 0 }),
      removeWorktree: async () => {},
      probeDirectories: async () => ({ exists: {} }),
      archiveSession: async () => {},
      deleteWorkspace: async () => {},
      ...over,
    }
  }

  it('removes clean targets through the shared flow, unforced', async () => {
    const calls: Array<{ path: string; force: boolean }> = []
    const report = await runAutoPrune(deps({
      removeWorktree: async (path, force) => { calls.push({ path, force }) },
    }), [
      { path: 'D:/wt/r-a', force: true, workspaceId: 'ws-a', archiveSessionIds: ['s1'] },
    ])
    expect(calls).toEqual([{ path: 'D:/wt/r-a', force: false }])
    expect(report.removed).toEqual(['D:/wt/r-a'])
    expect(report.skippedDirty).toEqual([])
    expect(report.failed).toEqual([])
  })

  it('skips a dirty target without touching it', async () => {
    const removed: string[] = []
    const report = await runAutoPrune(deps({
      inspectWorktree: async (path) => ({ dirty: path.endsWith('b') ? 3 : 0 }),
      removeWorktree: async (path) => { removed.push(path) },
    }), [{ path: 'D:/wt/r-b', force: false }, { path: 'D:/wt/r-a', force: false }])
    expect(removed).toEqual(['D:/wt/r-a'])
    expect(report.skippedDirty).toEqual(['D:/wt/r-b'])
  })

  it('records a failed removal and keeps walking', async () => {
    const report = await runAutoPrune(deps({
      removeWorktree: async (path) => { if (path.endsWith('a')) throw new Error('EPERM: locked') },
    }), [{ path: 'D:/wt/r-a', force: false }, { path: 'D:/wt/r-c', force: false }])
    expect(report.removed).toEqual(['D:/wt/r-c'])
    expect(report.failed).toEqual([{ path: 'D:/wt/r-a', message: 'EPERM: locked' }])
  })

  it('records an inspect failure the same as a removal failure', async () => {
    const report = await runAutoPrune(deps({
      inspectWorktree: async () => { throw new Error('not a repository') },
    }), [{ path: 'D:/wt/r-a', force: false }])
    expect(report.removed).toEqual([])
    expect(report.failed).toEqual([{ path: 'D:/wt/r-a', message: 'not a repository' }])
  })
})
