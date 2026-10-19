import { describe, expect, it } from 'vitest'
import {
  branchFactsStamp, buildTree, chainExpanded, collectFolderPaths, groupKey, groupRows, repoHasRemotes, syncActions, syncMark,
  type BranchRow, type TreeNode,
} from '../src/client/branch-tree.ts'
import { buildBranchRows, buildLinkedWorktreeRows } from '../src/client/BranchChip.tsx'
import type { BranchEntry, WorktreeEntry } from '../src/wire.ts'

const local = (name: string): BranchRow => ({ name, kind: 'local' })
const remote = (name: string): BranchRow => ({ name, kind: 'remote' })
const worktree = (name: string, path: string): BranchRow => ({ name, kind: 'worktree', path })

/** The tree as "path(total)" lines, depth-first in render order. */
function outline(nodes: TreeNode[], depth = 0, out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(`${'  '.repeat(depth)}${node.segment}${node.leaf === null ? '' : '*'}(${String(node.total)})`)
    outline(node.children, depth + 1, out)
  }
  return out
}

describe('groupRows', () => {
  it('splits the flat list into the three groups, order preserved', () => {
    const groups = groupRows([
      local('main'), remote('origin/dev'), worktree('feat/x', '/wt/x'), local('feat/y'),
    ])
    expect(groups.localRows.map(row => row.name)).toEqual(['main', 'feat/y'])
    expect(groups.worktreeRows.map(row => row.name)).toEqual(['feat/x'])
    expect(groups.remoteDisplayRows.map(row => row.name)).toEqual(['dev'])
  })

  it('strips the prefix under a SINGLE remote and maps the display name back', () => {
    const groups = groupRows([remote('origin/dev'), remote('origin/feat/x')])
    expect(groups.remoteDisplayRows.map(row => row.name)).toEqual(['dev', 'feat/x'])
    expect(groups.remoteNameMap.get('feat/x')).toBe('origin/feat/x')
    // Round-trip: what the row shows maps back to what the owner is sent.
    for (const row of groups.remoteDisplayRows) {
      expect(groups.remoteNameMap.get(row.name)).toContain('origin/')
    }
  })

  it('keeps full names with SEVERAL remotes so same-named branches stay apart', () => {
    const groups = groupRows([remote('origin/dev'), remote('upstream/dev')])
    expect(groups.remoteDisplayRows.map(row => row.name)).toEqual(['origin/dev', 'upstream/dev'])
    // An identity map when nothing was dropped.
    expect(groups.remoteNameMap.get('origin/dev')).toBe('origin/dev')
    expect(groups.remoteNameMap.get('upstream/dev')).toBe('upstream/dev')
  })

  it('leaves a slashless remote name alone (no prefix to strip)', () => {
    const groups = groupRows([remote('dev')])
    expect(groups.remoteDisplayRows.map(row => row.name)).toEqual(['dev'])
    expect(groups.remoteNameMap.get('dev')).toBe('dev')
  })

  it('answers empty groups and an empty map for no rows', () => {
    const groups = groupRows([])
    expect(groups.localRows).toEqual([])
    expect(groups.remoteDisplayRows).toEqual([])
    expect(groups.worktreeRows).toEqual([])
    expect(groups.remoteNameMap.size).toBe(0)
  })

  it('does not mutate the caller rows while deriving display names', () => {
    const rows = [remote('origin/dev')]
    groupRows(rows)
    expect(rows[0]?.name).toBe('origin/dev')
  })

  it('preserves ahead and behind counts on worktree rows', () => {
    const wtRow: BranchRow = { name: 'feat/wt', kind: 'worktree', path: '/wt/path', ahead: 3, behind: 1 }
    const groups = groupRows([wtRow])
    expect(groups.worktreeRows).toEqual([
      { name: 'feat/wt', kind: 'worktree', path: '/wt/path', ahead: 3, behind: 1 },
    ])
  })
})

describe('buildTree', () => {
  it('nests every segment boundary and totals the leaves upward', () => {
    const tree = buildTree([local('feature/x/y'), local('feature/x/z'), local('main')])
    expect(outline(tree)).toEqual([
      'feature(2)',
      '  x(2)',
      '    y*(1)',
      '    z*(1)',
      'main*(1)',
    ])
  })

  it('lets a branch be a folder at the same time', () => {
    // `feature` and `feature/x` are both legal git branch names; the node
    // must carry BOTH a leaf and children, and count itself in the total.
    const tree = buildTree([local('feature'), local('feature/x')])
    expect(outline(tree)).toEqual(['feature*(2)', '  x*(1)'])
    expect(tree[0]?.leaf?.name).toBe('feature')
  })

  it('sorts folders before leaves, then naturally and case-blind', () => {
    const tree = buildTree([local('zeta'), local('Alpha'), local('feat/v10'), local('feat/v2')])
    expect(outline(tree)).toEqual([
      'feat(2)',
      '  v2*(1)',
      '  v10*(1)',
      'Alpha*(1)',
      'zeta*(1)',
    ])
  })

  it('records the depth of every level from the root', () => {
    const tree = buildTree([local('a/b/c')])
    expect(tree[0]?.depth).toBe(0)
    expect(tree[0]?.children[0]?.depth).toBe(1)
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2)
  })

  it('ignores empty segments from doubled or trailing slashes', () => {
    const tree = buildTree([local('feat//x')])
    expect(outline(tree)).toEqual(['feat(1)', '  x*(1)'])
    expect(tree[0]?.children[0]?.path).toBe('feat/x')
  })

  it('answers an empty root for no rows', () => {
    expect(buildTree([])).toEqual([])
  })
})

describe('collectFolderPaths', () => {
  it('lists only the nodes that render a header, depth-first', () => {
    const tree = buildTree([local('a/b/c'), local('a/d'), local('solo')])
    // `solo` has no children and never renders a folder header.
    expect(collectFolderPaths(tree)).toEqual(['a', 'a/b'])
  })

  it('counts a branch that is also a folder as a folder', () => {
    expect(collectFolderPaths(buildTree([local('feature'), local('feature/x')]))).toEqual(['feature'])
  })

  it('answers nothing for a flat list', () => {
    expect(collectFolderPaths(buildTree([local('main'), local('dev')]))).toEqual([])
  })
})

describe('chainExpanded', () => {
  it('answers every PROPER ancestor of the branch path', () => {
    expect([...chainExpanded('feature/x/y')]).toEqual(['feature', 'feature/x'])
  })

  it('answers nothing for a bare name (it is its own root row)', () => {
    expect([...chainExpanded('main')]).toEqual([])
    expect([...chainExpanded('')]).toEqual([])
  })

  it('skips empty segments the same way buildTree does', () => {
    expect([...chainExpanded('feat//x/y')]).toEqual(['feat', 'feat/x'])
  })
})

describe('groupKey', () => {
  it('keeps same-named local and remote folders in separate toggle states', () => {
    expect(groupKey('local', 'feat/x')).not.toBe(groupKey('remote', 'feat/x'))
  })
})

describe('buildBranchRows', () => {
  it('keeps tracking identity for local, worktree and linked-worktree rows', () => {
    const branches: BranchEntry[] = [
      { name: 'main', kind: 'local', upstream: 'origin/main' },
      { name: 'topic', kind: 'local', upstream: 'origin/topic', upstreamGone: true },
    ]
    const worktrees: WorktreeEntry[] = [
      { path: '/repo', branch: 'main', main: true },
      { path: '/topic', branch: 'topic', main: false },
    ]
    const mainRows = buildBranchRows(branches, worktrees)
    expect(mainRows.find(row => row.name === 'main')).toMatchObject({ upstream: 'origin/main' })
    expect(mainRows.find(row => row.name === 'topic')).toMatchObject({ kind: 'worktree', upstream: 'origin/topic', upstreamGone: true })
    const linkedRows = buildLinkedWorktreeRows(branches, worktrees, 'topic')
    expect(linkedRows.find(row => row.name === 'topic')).toMatchObject({ kind: 'local', upstream: 'origin/topic', upstreamGone: true })
    expect(linkedRows.find(row => row.name === 'main')).toMatchObject({ kind: 'worktree', upstream: 'origin/main' })
  })

  it('inherits ahead and behind from the matching local branch into worktree rows', () => {
    const branches: BranchEntry[] = [
      { name: 'main', kind: 'local', ahead: 0, behind: 0 },
      { name: 'feat/wt-1', kind: 'local', ahead: 2, behind: 1 },
      { name: 'feat/wt-sync', kind: 'local' },
      { name: 'feat/normal', kind: 'local', ahead: 5 },
      { name: 'origin/feat/remote', kind: 'remote' },
    ]
    const worktrees: WorktreeEntry[] = [
      { path: '/repo', branch: 'main', main: true },
      { path: '/repo-wt-1', branch: 'feat/wt-1', main: false },
      { path: '/repo-wt-sync', branch: 'feat/wt-sync', main: false },
      { path: '/repo-detached', branch: undefined, main: false },
    ]

    const rows = buildBranchRows(branches, worktrees)

    // Local branches not held by linked worktrees remain in local group:
    expect(rows.find(r => r.name === 'main')).toEqual({
      name: 'main',
      kind: 'local',
      ahead: 0,
      behind: 0,
    })
    expect(rows.find(r => r.name === 'feat/normal')).toEqual({
      name: 'feat/normal',
      kind: 'local',
      ahead: 5,
    })
    // Branches held by linked worktrees leave the local group:
    expect(rows.find(r => r.kind === 'local' && r.name === 'feat/wt-1')).toBeUndefined()
    expect(rows.find(r => r.kind === 'local' && r.name === 'feat/wt-sync')).toBeUndefined()

    // Remote branches:
    expect(rows.find(r => r.name === 'origin/feat/remote')).toEqual({
      name: 'origin/feat/remote',
      kind: 'remote',
    })

    // Worktree rows:
    const wt1 = rows.find(r => r.kind === 'worktree' && r.name === 'feat/wt-1')
    expect(wt1).toEqual({
      name: 'feat/wt-1',
      kind: 'worktree',
      path: '/repo-wt-1',
      ahead: 2,
      behind: 1,
    })

    const wtSync = rows.find(r => r.kind === 'worktree' && r.name === 'feat/wt-sync')
    expect(wtSync).toEqual({
      name: 'feat/wt-sync',
      kind: 'worktree',
      path: '/repo-wt-sync',
    })
    expect(wtSync?.ahead).toBeUndefined()
    expect(wtSync?.behind).toBeUndefined()
  })

  it('safely handles worktree whose local branch is missing from branches list', () => {
    const branches: BranchEntry[] = [
      { name: 'main', kind: 'local' },
    ]
    const worktrees: WorktreeEntry[] = [
      { path: '/repo', branch: 'main', main: true },
      { path: '/repo-wt-orphan', branch: 'feat/orphan', main: false },
    ]
    const rows = buildBranchRows(branches, worktrees)
    const orphan = rows.find(r => r.name === 'feat/orphan')
    expect(orphan).toEqual({
      name: 'feat/orphan',
      kind: 'worktree',
      path: '/repo-wt-orphan',
    })
  })
})

describe('buildLinkedWorktreeRows', () => {
  it('inherits ahead and behind for linked worktrees and main checkout', () => {
    const branches: BranchEntry[] = [
      { name: 'main', kind: 'local', ahead: 1, behind: 0 },
      { name: 'feat/current', kind: 'local', ahead: 3, behind: 2 },
      { name: 'feat/other-wt', kind: 'local', ahead: 0, behind: 4 },
      { name: 'feat/unheld', kind: 'local' },
    ]
    const worktrees: WorktreeEntry[] = [
      { path: '/repo', branch: 'main', main: true },
      { path: '/repo-current', branch: 'feat/current', main: false },
      { path: '/repo-other-wt', branch: 'feat/other-wt', main: false },
    ]

    const rows = buildLinkedWorktreeRows(branches, worktrees, 'feat/current')

    // Current branch is the first local row, with ahead/behind:
    expect(rows[0]).toEqual({
      name: 'feat/current',
      kind: 'local',
      ahead: 3,
      behind: 2,
    })

    // Main checkout worktree row reflects main branch's ahead/behind and has mainWorktree flag:
    const mainWt = rows.find(r => r.kind === 'worktree' && r.name === 'main')
    expect(mainWt).toEqual({
      name: 'main',
      kind: 'worktree',
      path: '/repo',
      mainWorktree: true,
      ahead: 1,
      behind: 0,
    })

    // Other linked worktree row inherits ahead/behind:
    const otherWt = rows.find(r => r.kind === 'worktree' && r.name === 'feat/other-wt')
    expect(otherWt).toEqual({
      name: 'feat/other-wt',
      kind: 'worktree',
      path: '/repo-other-wt',
      ahead: 0,
      behind: 4,
    })

    // Other branches not held by worktrees are omitted:
    expect(rows.find(r => r.name === 'feat/unheld')).toBeUndefined()
    // Current branch worktree row is not duplicated in worktree group:
    expect(rows.filter(r => r.name === 'feat/current')).toHaveLength(1)
  })
})

describe('syncMark', () => {
  const row = (extra: Partial<BranchRow>): BranchRow => ({ name: 'feat/x', kind: 'local', ...extra })

  it('marks a branch with no upstream "unpublished", but only where a remote exists', () => {
    expect(syncMark(row({}), true)).toEqual({ kind: 'diverged', outgoing: 'unpublished', incoming: null })
    // A purely local repository: every branch would read unpublished, which is noise.
    expect(syncMark(row({}), false)).toBeNull()
    expect(syncMark(row({ kind: 'worktree', path: '/wt' }), false)).toBeNull()
  })

  it('shows commits ahead as outgoing and commits behind as incoming', () => {
    expect(syncMark(row({ upstream: 'origin/x', ahead: 2 }), true)).toEqual({ kind: 'diverged', outgoing: 2, incoming: null })
    expect(syncMark(row({ upstream: 'origin/x', behind: 3 }), true)).toEqual({ kind: 'diverged', outgoing: null, incoming: 3 })
    expect(syncMark(row({ upstream: 'origin/x', ahead: 1, behind: 4 }), true)).toEqual({ kind: 'diverged', outgoing: 1, incoming: 4 })
  })

  it('shows nothing for a branch in sync, and nothing for a remote row', () => {
    expect(syncMark(row({ upstream: 'origin/x', ahead: 0, behind: 0 }), true)).toBeNull()
    expect(syncMark(row({ upstream: 'origin/x' }), true)).toBeNull()
    expect(syncMark({ name: 'origin/x', kind: 'remote' }, true)).toBeNull()
  })

  it('reports a vanished upstream by name, whatever the remote situation', () => {
    expect(syncMark(row({ upstream: 'origin/x', upstreamGone: true, ahead: 5 }), true)).toEqual({ kind: 'gone', upstream: 'origin/x' })
    expect(syncMark(row({ upstream: 'origin/x', upstreamGone: true }), false)).toEqual({ kind: 'gone', upstream: 'origin/x' })
  })
})

describe('repoHasRemotes', () => {
  it('sees a remote-tracking ref or any branch that names an upstream', () => {
    expect(repoHasRemotes([{ kind: 'local' }, { kind: 'local' }])).toBe(false)
    expect(repoHasRemotes([])).toBe(false)
    expect(repoHasRemotes([{ kind: 'local' }, { kind: 'remote' }])).toBe(true)
    expect(repoHasRemotes([{ kind: 'local', upstream: 'origin/main' }])).toBe(true)
  })
})

describe('syncActions', () => {
  const row = (extra: Partial<BranchRow>): BranchRow => ({ name: 'feat/x', kind: 'local', ...extra })

  it('offers push on every local and worktree row, with or without a checkout', () => {
    expect(syncActions(row({}), 'main')).toEqual(['push'])
    expect(syncActions(row({ kind: 'worktree', path: '/wt' }), 'main')).toEqual(['push'])
  })

  it('adds update only for the checked-out branch and only with a live upstream', () => {
    expect(syncActions(row({ upstream: 'origin/x' }), 'feat/x')).toEqual(['push', 'update'])
    expect(syncActions(row({ upstream: 'origin/x' }), 'main')).toEqual(['push'])
    expect(syncActions(row({}), 'feat/x')).toEqual(['push'])
    expect(syncActions(row({ upstream: 'origin/x', upstreamGone: true }), 'feat/x')).toEqual(['push'])
  })

  it('offers nothing on a remote row', () => {
    expect(syncActions({ name: 'origin/x', kind: 'remote' }, 'feat/x')).toEqual([])
  })
})

describe('branchFactsStamp', () => {
  it('changes when the checked-out branch or its upstream counts move', () => {
    const branches = [{ kind: 'local', name: 'main', ahead: 0, behind: 1, upstream: 'origin/main' }]
    const first = branchFactsStamp('main', branches)
    expect(branchFactsStamp('main', branches)).toBe(first)
    expect(branchFactsStamp('main', [{ ...branches[0]!, behind: 2 }])).not.toBe(first)
    expect(branchFactsStamp('topic', branches)).not.toBe(first)
  })
})
