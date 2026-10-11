import { describe, expect, it } from 'vitest'
import { groupScanEntries } from '../src/client/scan-groups.ts'
import type { WorktreeScanEntry } from '../src/wire.ts'

describe('groupScanEntries', () => {
  it('groups entries by source and repoName in order: project < agent < legacy', () => {
    const entries: WorktreeScanEntry[] = [
      { path: '/wt/legacy-1', repoName: 'my-repo', branch: 'feat/old', source: 'legacy' },
      { path: '/wt/agent-1', repoName: 'my-repo', branch: 'agent/task', source: 'agent' },
      { path: '/wt/proj-1', repoName: 'my-repo', branch: 'feat/new', source: 'project' },
    ]
    const groups = groupScanEntries(entries)
    expect(groups.map(g => ({ source: g.source, repoName: g.repoName }))).toEqual([
      { source: 'project', repoName: 'my-repo' },
      { source: 'agent', repoName: 'my-repo' },
      { source: 'legacy', repoName: 'my-repo' },
    ])
  })

  it('sorts repositories alphabetically with numeric awareness within the same source', () => {
    const entries: WorktreeScanEntry[] = [
      { path: '/wt/p10', repoName: 'repo10', branch: 'main', source: 'project' },
      { path: '/wt/p2', repoName: 'repo2', branch: 'main', source: 'project' },
      { path: '/wt/a10', repoName: 'repo10', branch: 'main', source: 'agent' },
      { path: '/wt/a2', repoName: 'repo2', branch: 'main', source: 'agent' },
    ]
    const groups = groupScanEntries(entries)
    expect(groups.map(g => `${g.source}:${g.repoName}`)).toEqual([
      'project:repo2',
      'project:repo10',
      'agent:repo2',
      'agent:repo10',
    ])
  })

  it('sorts entries within a group by branch name with numeric awareness', () => {
    const entries: WorktreeScanEntry[] = [
      { path: '/wt/a', repoName: 'repo', branch: 'feat/v10', source: 'agent' },
      { path: '/wt/b', repoName: 'repo', branch: 'feat/v2', source: 'agent' },
      { path: '/wt/c', repoName: 'repo', branch: 'fix/bug', source: 'agent' },
    ]
    const groups = groupScanEntries(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].entries.map(e => e.branch)).toEqual([
      'feat/v2',
      'feat/v10',
      'fix/bug',
    ])
  })

  it('collects entries with null repoName into a single orphans group at the end', () => {
    const entries: WorktreeScanEntry[] = [
      { path: '/wt/orphan-1', repoName: null, branch: null, source: 'legacy' },
      { path: '/wt/proj-1', repoName: 'my-repo', branch: 'main', source: 'project' },
      { path: '/wt/orphan-2', repoName: null, branch: null, source: 'agent' },
    ]
    const groups = groupScanEntries(entries)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({
      repoName: 'my-repo',
      source: 'project',
      entries: [{ path: '/wt/proj-1', repoName: 'my-repo', branch: 'main', source: 'project' }],
    })
    expect(groups[1]).toEqual({
      repoName: null,
      source: 'orphans',
      entries: [
        { path: '/wt/orphan-1', repoName: null, branch: null, source: 'legacy' },
        { path: '/wt/orphan-2', repoName: null, branch: null, source: 'agent' },
      ],
    })
  })

  it('handles empty input gracefully', () => {
    expect(groupScanEntries([])).toEqual([])
  })
})
