import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitFacts } from '../src/wire.ts'
import { closeWorktreeAction, getWorktreeAction } from '../src/client/action-bus.ts'
import {
  CONTEXT_MENU_ICON_KEYS,
  CONTEXT_MENU_ORDER,
  registerNativeContextMenus,
  type ContextMenuContributionLike,
  type ContextMenusLike,
  type GitWorktreeContextMenuTargetMap,
} from '../src/client/context-menus.ts'
import { createWorkspaceGitCache } from '../src/client/workspace-git-cache.ts'

const t = ((key: string) => key) as PropsLocale<'git-worktree'>['t']

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

function createFakeRegistry() {
  const entries = new Map<string, ContextMenuContributionLike<keyof GitWorktreeContextMenuTargetMap>>()
  const contextMenus: ContextMenusLike = {
    register(contribution) {
      const key = `${contribution.target}:${contribution.id}`
      entries.set(key, contribution as ContextMenuContributionLike<keyof GitWorktreeContextMenuTargetMap>)
      return () => { entries.delete(key) }
    },
  }
  return { entries, contextMenus }
}

describe('registerNativeContextMenus', () => {
  afterEach(() => {
    closeWorktreeAction()
  })

  it('shows create + scoped manage only on main git workspaces, only danger remove on linked worktrees, and hides on non-git dirs', async () => {
    const cache = createWorkspaceGitCache(async () => ({
      ok: true,
      facts: {
        '/code/app': MAIN_FACTS,
        '/code/app/.dsh/gitworktree/feat-menu': WT_FACTS,
        '/plain': null,
      },
    }))
    await cache.syncPaths(['/code/app', '/code/app/.dsh/gitworktree/feat-menu', '/plain'])

    const { entries, contextMenus } = createFakeRegistry()
    const dispose = registerNativeContextMenus({
      contextMenus,
      gitCache: cache,
      resolveSessionPath: () => undefined,
      t,
    })

    const wsContrib = entries.get('workspace:git-worktree.workspace')
    expect(wsContrib?.order).toBe(CONTEXT_MENU_ORDER.workspace)
    const signal = new AbortController().signal

    // Non-git directory: completely silent.
    expect(await wsContrib!.resolve({ workspaceId: 'ws-0', path: '/plain', displayTitle: 'plain' }, signal)).toEqual([])

    // Main git workspace: create + manage (pre-scoped to this repository), no remove.
    const mainActions = await wsContrib!.resolve({ workspaceId: 'ws-1', path: '/code/app', displayTitle: 'app' }, signal)
    expect(mainActions.map(a => a.id)).toEqual(['create', 'manage'])
    expect(mainActions[0]?.separatorBefore).toBe(true)
    expect(mainActions[0]?.icon).toEqual({ key: CONTEXT_MENU_ICON_KEYS.create })
    expect(mainActions[1]?.icon).toEqual({ key: CONTEXT_MENU_ICON_KEYS.manage })

    await mainActions[1]?.run?.()
    expect(getWorktreeAction()).toEqual({
      kind: 'manage',
      repoFilter: { repoRoot: '/code/app', repoName: 'app' },
    })

    await mainActions[0]?.run?.()
    expect(getWorktreeAction()).toEqual({
      kind: 'create',
      repoPath: '/code/app',
      repoName: 'app',
    })

    // Linked worktree workspace: only exposes danger remove (no create/manage).
    const wtActions = await wsContrib!.resolve(
      { workspaceId: 'ws-2', path: '/code/app/.dsh/gitworktree/feat-menu', displayTitle: 'feat-menu' },
      signal,
    )
    expect(wtActions.map(a => a.id)).toEqual(['remove'])
    expect(wtActions[0]?.danger).toBe(true)
    expect(wtActions[0]?.separatorBefore).toBe(true)
    expect(wtActions[0]?.icon).toEqual({ key: CONTEXT_MENU_ICON_KEYS.remove })

    await wtActions[0]?.run?.()
    expect(getWorktreeAction()).toEqual({
      kind: 'remove',
      path: '/code/app/.dsh/gitworktree/feat-menu',
      branch: 'feat/menu',
    })

    dispose()
    expect(entries.size).toBe(0)
  })

  it('exposes only "remove this worktree" on linked worktree sessions and headers, leaving main and non-git sessions untouched', async () => {
    const cache = createWorkspaceGitCache(async () => ({
      ok: true,
      facts: {
        '/code/app': MAIN_FACTS,
        '/code/app/.dsh/gitworktree/feat-menu': WT_FACTS,
        '/plain': null,
      },
    }))
    await cache.syncPaths(['/code/app', '/code/app/.dsh/gitworktree/feat-menu', '/plain'])

    const pathsBySession: Record<string, string> = {
      's-main': '/code/app',
      's-wt': '/code/app/.dsh/gitworktree/feat-menu',
      's-plain': '/plain',
    }
    const { entries, contextMenus } = createFakeRegistry()
    registerNativeContextMenus({
      contextMenus,
      gitCache: cache,
      resolveSessionPath: id => pathsBySession[id],
      t,
    })

    const signal = new AbortController().signal
    const sessionContrib = entries.get('session:git-worktree.session')!
    const headerContrib = entries.get('sessionHeader:git-worktree.sessionHeader')!

    expect(await sessionContrib.resolve({ sessionId: 's-main', displayTitle: 'Main' }, signal)).toEqual([])
    expect(await sessionContrib.resolve({ sessionId: 's-plain', displayTitle: 'Plain' }, signal)).toEqual([])
    expect(await headerContrib.resolve({ sessionId: 's-main' }, signal)).toEqual([])

    const wtRowActions = await sessionContrib.resolve({ sessionId: 's-wt', displayTitle: 'WT' }, signal)
    expect(wtRowActions).toHaveLength(1)
    expect(wtRowActions[0]).toMatchObject({
      id: 'remove',
      label: 'contextMenu.removeWorktree',
      danger: true,
      separatorBefore: true,
      icon: { key: CONTEXT_MENU_ICON_KEYS.remove },
    })

    const wtHeaderActions = await headerContrib.resolve({ sessionId: 's-wt' }, signal)
    expect(wtHeaderActions).toHaveLength(1)
    await wtHeaderActions[0]?.run?.()
    expect(getWorktreeAction()).toEqual({
      kind: 'remove',
      path: '/code/app/.dsh/gitworktree/feat-menu',
      branch: 'feat/menu',
    })
  })

  it('triggers a non-blocking background probe on cache miss without delaying menu opening', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true as const,
      facts: { '/code/new-wt': WT_FACTS },
    }))
    const cache = createWorkspaceGitCache(fetcher)
    const { entries, contextMenus } = createFakeRegistry()
    registerNativeContextMenus({
      contextMenus,
      gitCache: cache,
      resolveSessionPath: () => '/code/new-wt',
      t,
    })

    const sessionContrib = entries.get('session:git-worktree.session')!
    const immediate = sessionContrib.resolve({ sessionId: 's-1', displayTitle: 'New' }, new AbortController().signal)
    // Must be synchronous empty array on cold miss, never a blocking Promise.
    expect(Array.isArray(immediate)).toBe(true)
    expect(immediate).toEqual([])
    expect(fetcher).toHaveBeenCalledWith(['/code/new-wt'])

    await Promise.resolve()
    const afterProbe = sessionContrib.resolve({ sessionId: 's-1', displayTitle: 'New' }, new AbortController().signal)
    expect(afterProbe).toHaveLength(1)
  })
})
