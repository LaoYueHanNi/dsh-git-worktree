import { describe, expect, it, vi } from 'vitest'
import {
  EXPAND_STORAGE_KEY, deriveSidebarGroups, loadExpandState, orderedVisibleSessionIds, saveExpandState, visibleSessionIds,
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
