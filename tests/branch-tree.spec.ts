import { describe, expect, it } from 'vitest'
import {
  buildTree, chainExpanded, collectFolderPaths, groupKey, groupRows,
  type BranchRow, type TreeNode,
} from '../src/client/branch-tree.ts'

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
