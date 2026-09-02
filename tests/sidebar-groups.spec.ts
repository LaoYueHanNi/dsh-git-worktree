import { describe, expect, it, vi } from 'vitest'
import {
  EXPAND_STORAGE_KEY, FACTS_STORAGE_KEY, GROUP_BOOT_STORAGE_KEY, deriveSidebarGroups, deriveStrayGroups, factsForSignature, loadExpandState, loadFactsCache, loadGroupSidebarBoot, orderedVisibleSessionIds, saveExpandState, saveFactsCache, saveGroupSidebarBoot, visibleSessionIds,
  type SessionListLike, type WorkspaceLike,
} from '../src/client/sidebar-groups.ts'
import type { WorkspaceGitFacts } from '../src/wire.ts'

/** Workspace view shaped after the real registry rows. */
function ws(workspaceId: string, path: string, sessionIds: string[] = []): WorkspaceLike {
  return { workspaceId, path, title: path.split(/[/\\]/).pop() ?? path, sessionIds }
}

/** Git facts for a repository member. */
function gitFacts(repoRoot: string, repoName: string, branch: string | null, main: boolean): WorkspaceGitFacts {
  return { repoRoot, repoName, branch, main }
}

/** The two-workspace scenario this feature ships for: main + one linked. */
const MAIN_PATH = 'E:\\Documents\\MyCode\\oyw-dsh-plugin\\dsh-git-worktree'
const LINKED_PATH = 'E:\\Documents\\dsh\\gitworktree\\dsh-git-worktree-feat-x'
const REPO_ROOT = MAIN_PATH

function twoWorkspacesFixture(): { items: WorkspaceLike[]; facts: Record<string, WorkspaceGitFacts> } {
  return {
    items: [
      ws('w1', 'E:\\Documents\\MyCode\\deepseek-harness', ['s-deepseek']),
      ws('w2', MAIN_PATH, ['s-main-1', 's-main-2']),
      ws('w3', LINKED_PATH, ['s-wt-1']),
    ],
    facts: {
      'E:\\Documents\\MyCode\\deepseek-harness': gitFacts('E:\\Documents\\MyCode\\deepseek-harness', 'deepseek-harness', 'master', true),
      [MAIN_PATH]: gitFacts(REPO_ROOT, 'dsh-git-worktree', 'main', true),
      [LINKED_PATH]: gitFacts(REPO_ROOT, 'dsh-git-worktree', 'feat-x', false),
    },
  }
}

describe('deriveSidebarGroups', () => {
  it('clusters same-repository workspaces with the main member first', () => {
    const { items, facts } = twoWorkspacesFixture()
    const groups = deriveSidebarGroups(items, facts)
    expect(groups).toHaveLength(2)

    const repo = groups[1]
    expect(repo.kind).toBe('repo')
    expect(repo.repoName).toBe('dsh-git-worktree')
    expect(repo.key).toBe(`repo:${REPO_ROOT}`)
    expect(repo.members.map(member => member.label)).toEqual([
      { type: 'main', branch: 'main' },
      { type: 'linked', branch: 'feat-x' },
    ])
  })

  it('degrades a single-member repository to a plain row (zero visual intrusion)', () => {
    const { items, facts } = twoWorkspacesFixture()
    const lone = groups0(deriveSidebarGroups(items, facts))
    expect(lone.kind).toBe('single')
    expect(lone.members[0]?.label).toEqual({ type: 'plain' })
    // Single rows keep the workspace's own stable key, not a repo key.
    expect(lone.key).toBe('ws:w1')
  })

  it('answers plain rows while facts are unknown or null (loading and non-git)', () => {
    const items = [ws('w1', 'E:\\a'), ws('w2', 'E:\\b')]
    for (const factsCase of [undefined, { 'E:\\a': null }]) {
      const groups = deriveSidebarGroups(items, factsCase)
      expect(groups.every(group => group.kind === 'single' && group.members[0]?.label.type === 'plain'))
        .toBe(true)
    }
  })

  it('anchors a group at the first member\'s registry slot', () => {
    const { items, facts } = twoWorkspacesFixture()
    const groups = deriveSidebarGroups(items, facts)
    // The repo group claims w2's slot (first-seen), so it renders after the
    // lone deepseek-harness row and w3 never appears as a top-level row.
    expect(groups.map(group => group.kind)).toEqual(['single', 'repo'])
    expect(groups[1]?.members.map(member => member.workspace.workspaceId)).toEqual(['w2', 'w3'])
  })

  it('keeps a linked-only cluster grouped with no main member', () => {
    const items = [ws('w1', 'E:\\other'), ws('w2', 'E:\\wt\\a'), ws('w3', 'E:\\wt\\b')]
    const facts: Record<string, WorkspaceGitFacts> = {
      'E:\\other': gitFacts('E:\\other', 'other', 'main', true),
      'E:\\wt\\a': gitFacts('E:\\repo', 'repo', 'a', false),
      'E:\\wt\\b': gitFacts('E:\\repo', 'repo', 'b', false),
    }
    const groups = deriveSidebarGroups(items, facts)
    expect(groups).toHaveLength(2)
    const repo = groups[1]
    expect(repo.members.map(member => member.label.type)).toEqual(['linked', 'linked'])
  })

  it('moves the main member first even when a linked workspace registered earlier', () => {
    const items = [ws('w-linked', LINKED_PATH), ws('w-main', MAIN_PATH)]
    const facts: Record<string, WorkspaceGitFacts> = {
      [LINKED_PATH]: gitFacts(REPO_ROOT, 'dsh-git-worktree', 'feat-x', false),
      [MAIN_PATH]: gitFacts(REPO_ROOT, 'dsh-git-worktree', 'main', true),
    }
    const groups = deriveSidebarGroups(items, facts)
    expect(groups[0]?.members.map(member => member.workspace.workspaceId)).toEqual(['w-main', 'w-linked'])
  })
})

/** First group of a derivation, typed for the single-row assertions. */
function groups0(groups: readonly ReturnType<typeof deriveSidebarGroups>[number][]): ReturnType<typeof deriveSidebarGroups>[number] {
  const first = groups[0]
  if (first === undefined) throw new Error('expected at least one group')
  return first
}

describe('visibleSessionIds', () => {
  const sessions: SessionListLike = {
    ids: ['s1', 's2', 's3', 's4', 's5'],
    byId: {
      s1: { id: 's1', displayTitle: 'One', blank: false },
      s2: { id: 's2', displayTitle: 'Sub', blank: false, origin: 'subagent' },
      s3: { id: 's3', displayTitle: 'Blank', blank: true },
      s4: { id: 's4', displayTitle: 'Archived', blank: false },
      s5: { id: 's5', displayTitle: 'Two', blank: false },
    },
    current: 's3',
  }

  it('keeps stored order and drops subagent and archived rows', () => {
    const workspace = ws('w', 'E:\\repo', ['s1', 's2', 's4', 's5'])
    expect(visibleSessionIds(workspace, sessions, ['s4'])).toEqual(['s1', 's5'])
  })

  it('shows a blank row only while it is the current selection', () => {
    const workspace = ws('w', 'E:\\repo', ['s3', 's1'])
    expect(visibleSessionIds(workspace, sessions, [])).toEqual(['s3', 's1'])
    expect(visibleSessionIds(workspace, { ...sessions, current: 's1' }, [])).toEqual(['s1'])
  })
})

describe('orderedVisibleSessionIds / indexSubagentRunning', () => {
  it('sorts by recency when orderBy is updated and keeps stored order otherwise', () => {
    const workspace = ws('w', 'E:\\repo', ['s1', 's5'])
    const recency: SessionListLike = {
      ids: ['s1', 's5'],
      byId: {
        s1: { id: 's1', displayTitle: 'One', blank: false, updatedAt: 1 },
        s5: { id: 's5', displayTitle: 'Two', blank: false, updatedAt: 9 },
      },
      current: undefined,
    }
    expect(orderedVisibleSessionIds(workspace, recency, [], 'manual')).toEqual(['s1', 's5'])
    expect(orderedVisibleSessionIds(workspace, recency, [], 'updated')).toEqual(['s5', 's1'])
  })
})

describe('deriveStrayGroups', () => {
  /** Session summary shaped after the runtime projection. */
  function sess(id: string, cwd: string | undefined, over: Partial<SessionListLike['byId'][string]> = {}): NonNullable<SessionListLike['byId'][string]> {
    return { id, displayTitle: id, blank: false, cwd, ...over }
  }

  it('clusters loose sessions by cwd and skips accounted ones', () => {
    const items = [ws('w1', 'E:\\repo', ['s-kept'])]
    const list: SessionListLike = {
      ids: ['s-kept', 's-loose-a', 's-loose-b', 's-loose-other'],
      byId: {
        's-kept': sess('s-kept', 'E:\\repo'),
        's-loose-a': sess('s-loose-a', 'E:\\gone\\repo'),
        's-loose-b': sess('s-loose-b', 'e:\\GONE\\repo'), // casing drift, same directory
        's-loose-other': sess('s-loose-other', 'E:\\elsewhere'),
      },
      current: undefined,
    }
    const groups = deriveStrayGroups(items, list, [])
    expect(groups.map(group => [group.path, group.sessions.map(s => s.id), group.belongsTo])).toEqual([
      ['E:\\gone\\repo', ['s-loose-a', 's-loose-b'], undefined],
      ['E:\\elsewhere', ['s-loose-other'], undefined],
    ])
    // One cluster per directory regardless of casing: the key is lowercased.
    expect(groups[0]?.key).toBe(`stray:e:\\gone\\repo`)
  })

  it('marks a cluster whose directory matches a registered workspace as that workspace\'s strays', () => {
    const items = [ws('w1', 'E:\\repo', ['s-kept'])]
    const list: SessionListLike = {
      ids: ['s-stray'],
      byId: { 's-stray': sess('s-stray', 'E:\\REPO') },
      current: undefined,
    }
    const groups = deriveStrayGroups(items, list, [])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.belongsTo).toBe(items[0]!.title)
  })

  it('applies the shared visibility rule (archived, subagent, non-current blank)', () => {
    const list: SessionListLike = {
      ids: ['s-archived', 's-sub', 's-blank', 's-blank-current', 's-live'],
      byId: {
        's-archived': sess('s-archived', 'E:\\a'),
        's-sub': sess('s-sub', 'E:\\a', { origin: 'subagent' }),
        's-blank': sess('s-blank', 'E:\\a', { blank: true }),
        's-blank-current': sess('s-blank-current', 'E:\\a', { blank: true }),
        's-live': sess('s-live', 'E:\\a'),
      },
      current: 's-blank-current',
    }
    const groups = deriveStrayGroups([], list, ['s-archived'])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map(s => s.id)).toEqual(['s-blank-current', 's-live'])
  })

  it('collects header-less cwd sessions into one unknown-directory cluster', () => {
    const list: SessionListLike = {
      ids: ['s-no-cwd'],
      byId: { 's-no-cwd': sess('s-no-cwd', undefined) },
      current: undefined,
    }
    const groups = deriveStrayGroups([], list, [])
    expect(groups).toEqual([{
      kind: 'stray',
      key: 'stray:?',
      path: '',
      belongsTo: undefined,
      sessions: [list.byId['s-no-cwd']],
    }])
  })

  it('answers empty when every session is accounted or hidden', () => {
    const items = [ws('w1', 'E:\\repo', ['s1'])]
    const list: SessionListLike = {
      ids: ['s1', 's-archived'],
      byId: {
        s1: sess('s1', 'E:\\repo'),
        's-archived': sess('s-archived', 'E:\\gone'),
      },
      current: undefined,
    }
    expect(deriveStrayGroups(items, list, ['s-archived'])).toEqual([])
  })
})

describe('expand state storage', () => {
  it('round-trips through localStorage and tolerates its absence', () => {
    // No localStorage in the node environment: reads answer {} and writes no-op.
    expect(loadExpandState()).toEqual({})
    expect(() => saveExpandState({ 'repo:E:\\repo': true })).not.toThrow()

    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      saveExpandState({ 'repo:E:\\repo': true, 'ws:w1': false })
      expect(loadExpandState()).toEqual({ 'repo:E:\\repo': true, 'ws:w1': false })
      store.set(EXPAND_STORAGE_KEY, '{not json')
      expect(loadExpandState()).toEqual({})
      store.set(EXPAND_STORAGE_KEY, '{"repo:E\\repo":1,"ws:w2":true}')
      expect(loadExpandState()).toEqual({ 'ws:w2': true })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('grouping boot cache', () => {
  it('round-trips the last-known switch value and tolerates absence and garbage', () => {
    // No localStorage in the node environment: reads answer undefined and
    // writes no-op.
    expect(loadGroupSidebarBoot()).toBeUndefined()
    expect(() => saveGroupSidebarBoot(true)).not.toThrow()

    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      expect(loadGroupSidebarBoot()).toBeUndefined()
      saveGroupSidebarBoot(false)
      expect(loadGroupSidebarBoot()).toBe(false)
      saveGroupSidebarBoot(true)
      expect(loadGroupSidebarBoot()).toBe(true)
      store.set(GROUP_BOOT_STORAGE_KEY, 'junk')
      expect(loadGroupSidebarBoot()).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('facts cache', () => {
  const facts: Record<string, WorkspaceGitFacts | null> = {
    'E:\\repo': { repoRoot: 'E:\\repo', repoName: 'repo', branch: 'main', main: true },
    'E:\\plain': null,
  }

  it('round-trips the last /group batch and tolerates absence and garbage', () => {
    // No localStorage in the node environment: reads answer null and writes no-op.
    expect(loadFactsCache()).toBeNull()
    expect(() => saveFactsCache({ signature: 'E:\\repo', facts })).not.toThrow()

    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      expect(loadFactsCache()).toBeNull()
      saveFactsCache({ signature: 'E:\\repo\nE:\\plain', facts })
      expect(loadFactsCache()).toEqual({ signature: 'E:\\repo\nE:\\plain', facts })
      store.set(FACTS_STORAGE_KEY, '{not json')
      expect(loadFactsCache()).toBeNull()
      store.set(FACTS_STORAGE_KEY, '{"signature":1,"facts":{}}')
      expect(loadFactsCache()).toBeNull()
      store.set(FACTS_STORAGE_KEY, '{"signature":"s","facts":"x"}')
      expect(loadFactsCache()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('discards a batch when any path value is not a WorkspaceGitFacts or null', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      store.set(FACTS_STORAGE_KEY, JSON.stringify({
        signature: 'E:\\repo',
        facts: { 'E:\\repo': 'oops' },
      }))
      expect(loadFactsCache()).toBeNull()
      store.set(FACTS_STORAGE_KEY, JSON.stringify({
        signature: 'E:\\repo',
        facts: { 'E:\\repo': { repoRoot: 'E:\\repo', repoName: 'repo', branch: 1, main: true } },
      }))
      expect(loadFactsCache()).toBeNull()
      store.set(FACTS_STORAGE_KEY, JSON.stringify({
        signature: 'E:\\repo',
        facts: { 'E:\\repo': { repoRoot: '', repoName: 'repo', branch: 'main', main: true } },
      }))
      expect(loadFactsCache()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps known fields and drops extras on a well-shaped entry', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    try {
      store.set(FACTS_STORAGE_KEY, JSON.stringify({
        signature: 'E:\\repo',
        facts: {
          'E:\\repo': { repoRoot: 'E:\\repo', repoName: 'repo', branch: 'main', main: true, extra: true },
        },
      }))
      expect(loadFactsCache()).toEqual({
        signature: 'E:\\repo',
        facts: { 'E:\\repo': { repoRoot: 'E:\\repo', repoName: 'repo', branch: 'main', main: true } },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('paints from cache once the path signature is known, even if live state still holds a previous snapshot', () => {
    const cached = { signature: 'E:\\repo\nE:\\plain', facts }
    expect(factsForSignature('', null, cached)).toBeNull()
    expect(factsForSignature('E:\\repo\nE:\\plain', null, cached)).toEqual(cached)
    expect(factsForSignature('E:\\repo\nE:\\plain', { signature: '', facts: {} }, cached)).toEqual(cached)
    const live = {
      signature: 'E:\\repo\nE:\\plain',
      facts: { 'E:\\repo': { repoRoot: 'E:\\repo', repoName: 'repo', branch: 'dev', main: true }, 'E:\\plain': null },
    }
    expect(factsForSignature('E:\\repo\nE:\\plain', live, cached)).toEqual(live)
    expect(factsForSignature('E:\\other', live, cached)).toBeNull()
  })
})
