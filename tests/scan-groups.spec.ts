import { describe, expect, it } from 'vitest'
import type { WorktreeScanEntry } from '../src/wire.ts'
import { filterScanEntriesByRepo, groupScanEntries } from '../src/client/scan-groups.ts'

describe('scan-groups repository scoping', () => {
  it('filters by canonical repoRoot when supplied, distinguishing same-basename repositories', () => {
    const entries: WorktreeScanEntry[] = [
      { path: '/work/a/app/.dsh/gitworktree/feat-1', repoRoot: '/work/a/app', repoName: 'app', branch: 'feat-1', source: 'project' },
      { path: '/work/b/app/.dsh/gitworktree/feat-2', repoRoot: '/work/b/app', repoName: 'app', branch: 'feat-2', source: 'project' },
      { path: '/legacy/orphan', repoName: null, branch: null, source: 'legacy' },
    ]

    const scoped = filterScanEntriesByRepo(entries, { repoRoot: '/work/a/app', repoName: 'app' })
    expect(scoped).toEqual([entries[0]])
    expect(groupScanEntries(scoped)).toEqual([
      { repoName: 'app', source: 'project', entries: [entries[0]] },
    ])
  })

  it('falls back to repoName matching when an older host omits repoRoot', () => {
    const entries: WorktreeScanEntry[] = [
      { path: '/legacy/app-feat', repoName: 'app', branch: 'feat', source: 'legacy' },
      { path: '/legacy/other-fix', repoName: 'other', branch: 'fix', source: 'legacy' },
    ]

    const scoped = filterScanEntriesByRepo(entries, { repoRoot: '/code/app', repoName: 'app' })
    expect(scoped).toEqual([entries[0]])
  })
})
