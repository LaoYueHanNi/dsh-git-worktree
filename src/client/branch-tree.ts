/**
 * The branch picker's data model: the flat row list turned into groups and
 * a '/' prefix tree.
 *
 * Extracted from BranchMenu.tsx because it is the component's only
 * genuinely tricky logic AND its only testable part. The standalone vitest
 * setup renders nothing (no jsdom, see tests/jsx-order.spec.ts on why the
 * static gates exist instead), so anything living inside the component
 * function has zero coverage by construction. Prefix compression, "a
 * branch that is also a folder", and single-vs-several remote prefix
 * stripping are exactly the rules that break quietly and are read back by
 * the search set, the expand-all scope, and the keyboard walk.
 *
 * @module git-worktree/client/branch-tree
 */

/** One selectable branch row. `name` is the ACTION name sent to the owner —
 * for a remote row the full `origin/feat-x`; the group model derives the
 * DISPLAY name (see groupRows). `ahead`/`behind` are local-row-only
 * upstream divergence counts (absent without an upstream or in sync).
 * `path` is worktree-row-only: the directory a pick hops the session into.
 * Every row here is actionable: a linked-worktree session does not send the
 * branches it must refuse down this path at all (its list is its own branch,
 * see the owner's `rows`), so there is no "dimmed but clickable" state to
 * encode. */
export interface BranchRow {
  name: string
  kind: 'local' | 'remote' | 'worktree'
  path?: string
  ahead?: number
  behind?: number
}

/** One node of the '/' prefix tree built from the row list: every segment
 * boundary is a folder level, so `feature/x/y` nests under `feature` and
 * `x`, and the leaves (rows) sit at the terminal nodes. */
export interface TreeNode {
  /** This node's own segment (the label text). */
  segment: string
  /** Full path: segments joined by '/'. Empty only at the root list. */
  path: string
  /** Depth from the root (root children are depth 0). */
  depth: number
  /** The branch named exactly `path`, if any — may coexist with children
   * (`feature` plus `feature/x` are both legal git branch names). */
  leaf: BranchRow | null
  /** Children, sorted folders-first then by segment. */
  children: TreeNode[]
  /** Leaf branches under this node, including its own leaf. */
  total: number
}

/**
 * The menu's group model derived from the flat row list: local rows as
 * they are, remote rows displayed under their group header, and worktree
 * rows collected as-is (one per linked worktree, direct hop targets). With
 * a SINGLE remote the `<remote>/` prefix is dropped from the display
 * (`origin/feat/x` reads as `feat/x` — the header already says "remote",
 * and a dropped display name can never collide with a local row because
 * the host hides remote branches that have a local twin); with SEVERAL
 * remotes the full name stays, so `origin`/`upstream` become the folder
 * layer that keeps same-named branches apart. `remoteNameMap` maps a
 * displayed remote name back to the action name (an identity map when
 * nothing was dropped).
 */
export interface BranchGroups {
  localRows: BranchRow[]
  remoteDisplayRows: BranchRow[]
  worktreeRows: BranchRow[]
  remoteNameMap: ReadonlyMap<string, string>
}

/** Segment order: natural (so `v2` precedes `v10`) and case-blind. */
export const segCmp = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Expanded-key space: folder paths carry their group prefix so a local
 * folder can never share a toggle state with a same-named remote display
 * folder (`feat/x` on both sides). Group OPEN flags stay booleans beside
 * this set — they are not part of the path namespace at all. */
export const groupKey = (group: 'local' | 'remote', path: string): string => `${group}:${path}`

/**
 * Split rows into the three groups and derive the remote display names.
 * @param rows - the flat row list, in host order.
 * @returns the three groups plus the display→action map for remotes.
 */
export function groupRows(rows: readonly BranchRow[]): BranchGroups {
  const localRows: BranchRow[] = []
  const remoteRows: BranchRow[] = []
  const worktreeRows: BranchRow[] = []
  for (const row of rows) {
    if (row.kind === 'remote') remoteRows.push(row)
    else if (row.kind === 'worktree') worktreeRows.push(row)
    else localRows.push(row)
  }
  const first = remoteRows[0]?.name ?? ''
  const slash = first.indexOf('/')
  const soleRemote = slash > 0 && remoteRows.every(row => row.name.startsWith(first.slice(0, slash + 1)))
    ? first.slice(0, slash)
    : undefined
  const display = (name: string): string => soleRemote === undefined ? name : name.slice(soleRemote.length + 1)
  return {
    localRows,
    remoteDisplayRows: remoteRows.map(row => ({ ...row, name: display(row.name) })),
    worktreeRows,
    remoteNameMap: new Map(remoteRows.map(row => [display(row.name), row.name])),
  }
}

/**
 * Build the prefix tree of the rows (see TreeNode).
 * @param rows - the rows of ONE group, named as they display.
 * @returns the root level, sorted folders-first and totalled.
 */
export function buildTree(rows: readonly BranchRow[]): TreeNode[] {
  /** Mutable builder node — same shape as TreeNode but built incrementally
   * (find-by-segment walks), sorted and totalled at the end. */
  interface M {
    segment: string
    path: string
    depth: number
    leaf: BranchRow | null
    children: M[]
    total: number
  }
  const root: M[] = []
  const find = (level: M[], segment: string): M | undefined =>
    level.find(n => n.segment === segment)
  for (const row of rows) {
    const segs = row.name.split('/').filter(s => s !== '')
    let level = root
    let path = ''
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i]
      if (seg === undefined) break
      path = path === '' ? seg : `${path}/${seg}`
      let node = find(level, seg)
      if (node === undefined) {
        node = { segment: seg, path, depth: i, leaf: null, children: [], total: 0 }
        level.push(node)
      }
      if (i === segs.length - 1) node.leaf = row
      level = node.children
    }
  }
  const finish = (nodes: M[]): void => {
    for (const node of nodes) finish(node.children)
    nodes.sort((a, b) => {
      const af = a.children.length > 0 ? 0 : 1
      const bf = b.children.length > 0 ? 0 : 1
      return af !== bf ? af - bf : segCmp(a.segment, b.segment)
    })
  }
  finish(root)
  const count = (nodes: M[]): void => {
    for (const node of nodes) {
      count(node.children)
      node.total = (node.leaf === null ? 0 : 1)
        + node.children.reduce((sum, c) => sum + c.total, 0)
    }
  }
  count(root)
  return root as unknown as TreeNode[]
}

/**
 * Every folder path that renders a header, walking the tree depth-first.
 * @param nodes - a tree level (the root list at the top call).
 * @param out - accumulator, for the recursion.
 * @returns the folder paths in render order.
 */
export function collectFolderPaths(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children.length > 0) {
      out.push(node.path)
      collectFolderPaths(node.children, out)
    }
  }
  return out
}

/**
 * The folders that must start expanded so the checked-out branch is
 * immediately visible in the tree: every proper ancestor of its path.
 * @param branch - the branch name (a bare name has no ancestors).
 * @returns the ancestor folder paths, unprefixed.
 */
export function chainExpanded(branch: string): Set<string> {
  const segs = branch.split('/').filter(s => s !== '')
  const set = new Set<string>()
  let path = ''
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i]
    if (seg === undefined) break
    path = path === '' ? seg : `${path}/${seg}`
    set.add(path)
  }
  return set
}
