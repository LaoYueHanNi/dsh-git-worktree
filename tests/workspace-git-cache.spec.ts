import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceGitFacts } from '../src/wire.ts'
import { createWorkspaceGitCache, isLinkedWorktreeFacts, resolveSessionPath } from '../src/client/workspace-git-cache.ts'

const MAIN_FACTS: WorkspaceGitFacts = {
  repoRoot: '/code/app',
  repoName: 'app',
  branch: 'main',
  main: true,
}

const WT_FACTS: WorkspaceGitFacts = {
  repoRoot: '/code/app',
  repoName: 'app',
  branch: 'feat/menu',
  main: false,
}

describe('workspace-git-cache', () => {
  it('syncs uncached paths in one batch, deduplicates concurrent calls, and notifies subscribers', async () => {
    let resolveFetch: ((value: { ok: true; facts: Record<string, WorkspaceGitFacts | null> }) => void) | undefined
    const fetcher = vi.fn(() => new Promise<{ ok: true; facts: Record<string, WorkspaceGitFacts | null> }>((resolve) => {
      resolveFetch = resolve
    }))
    const cache = createWorkspaceGitCache(fetcher)
    const listener = vi.fn()
    cache.subscribe(listener)

    const p1 = cache.syncPaths(['/code/app', '/code/app/.dsh/gitworktree/feat-menu', '/plain'])
    const p2 = cache.syncPaths(['/code/app'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(['/code/app', '/code/app/.dsh/gitworktree/feat-menu', '/plain'])

    resolveFetch?.({
      ok: true,
      facts: {
        '/code/app': MAIN_FACTS,
        '/code/app/.dsh/gitworktree/feat-menu': WT_FACTS,
        '/plain': null,
      },
    })
    await Promise.all([p1, p2])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(cache.get('/code/app')).toEqual(MAIN_FACTS)
    expect(cache.get('/code/app/.dsh/gitworktree/feat-menu')).toEqual(WT_FACTS)
    expect(cache.get('/plain')).toBeNull()

    // Already cached: no second network request.
    await cache.syncPaths(['/code/app', '/plain'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('prunes removed workspaces when pruneMissing is enabled and supports invalidate/refresh', async () => {
    const fetcher = vi.fn(async (paths: readonly string[]) => ({
      ok: true as const,
      facts: Object.fromEntries(paths.map(path => [path, path.includes('wt') ? WT_FACTS : MAIN_FACTS])),
    }))
    const cache = createWorkspaceGitCache(fetcher)
    await cache.syncPaths(['/code/app', '/code/wt-a'])
    expect(cache.get('/code/wt-a')).toEqual(WT_FACTS)

    await cache.syncPaths(['/code/app'], true)
    expect(cache.get('/code/wt-a')).toBeUndefined()
    expect(cache.get('/code/app')).toEqual(MAIN_FACTS)

    cache.invalidate('/code/app')
    expect(cache.get('/code/app')).toBeUndefined()

    await cache.refresh(['/code/app'])
    expect(cache.get('/code/app')).toEqual(MAIN_FACTS)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('swallows transient fetch errors so subsequent syncs can retry', async () => {
    let attempt = 0
    const cache = createWorkspaceGitCache(async (paths) => {
      attempt += 1
      if (attempt === 1) return { ok: false, error: 'network down' }
      return { ok: true, facts: Object.fromEntries(paths.map(p => [p, WT_FACTS])) }
    })

    await cache.syncPaths(['/code/wt-retry'])
    expect(cache.get('/code/wt-retry')).toBeUndefined()

    await cache.syncPaths(['/code/wt-retry'])
    expect(cache.get('/code/wt-retry')).toEqual(WT_FACTS)
  })

  it('identifies linked worktrees and resolves session directories with workspace fallback', () => {
    expect(isLinkedWorktreeFacts(WT_FACTS)).toBe(true)
    expect(isLinkedWorktreeFacts(MAIN_FACTS)).toBe(false)
    expect(isLinkedWorktreeFacts(null)).toBe(false)
    expect(isLinkedWorktreeFacts(undefined)).toBe(false)

    const workspaces = [{ path: '/code/wt-1', sessionIds: ['s-1', 's-2'] }]
    const sessions = {
      's-1': { cwd: '/code/override' },
      's-2': {},
    }
    expect(resolveSessionPath('s-1', sessions, workspaces)).toBe('/code/override')
    expect(resolveSessionPath('s-2', sessions, workspaces)).toBe('/code/wt-1')
    expect(resolveSessionPath('s-missing', sessions, workspaces)).toBeUndefined()
  })
})
