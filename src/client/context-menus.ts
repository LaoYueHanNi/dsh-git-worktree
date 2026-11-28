/**
 * Native DSH `ctx.contextMenus` contributions for `workspace`, `session`, and
 * `sessionHeader` targets (DSH >= 0.2.2-rc.5).
 *
 * Pure synchronous lookup against `WorkspaceGitCache` keeps menu opening
 * instantaneous: non-git directories and non-worktree sessions emit empty
 * arrays so native menus stay untouched.
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { openCheckoutPr, openCreateWorktree, openManageWorktrees, openRemoveWorktree } from './action-bus.ts'
import { isLinkedWorktreeFacts, type SnapshotObservable, type WorkspaceGitCache } from './workspace-git-cache.ts'

/** Minimal action face matching `@deepseek-ai/dsh-client-ui-context-menu/client`. */
export interface ContextMenuActionLike {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly icon?: { readonly key: string; readonly src?: string }
  readonly danger?: boolean
  readonly separatorBefore?: boolean
  readonly run?: () => void | Promise<void>
}

/** Target payloads consumed by git-worktree contributions. */
export interface GitWorktreeContextMenuTargetMap {
  workspace: { readonly workspaceId: string; readonly path: string; readonly displayTitle: string }
  session: { readonly sessionId: string; readonly displayTitle: string }
  sessionHeader: { readonly sessionId: string }
}

/** Minimal contribution face matching `@deepseek-ai/dsh-client-ui-context-menu/client`. */
export interface ContextMenuContributionLike<K extends keyof GitWorktreeContextMenuTargetMap> {
  readonly id: string
  readonly target: K
  readonly order: number
  observe?(target: GitWorktreeContextMenuTargetMap[K]): readonly SnapshotObservable<unknown>[]
  resolve(
    target: GitWorktreeContextMenuTargetMap[K],
    signal: AbortSignal,
  ): readonly ContextMenuActionLike[] | Promise<readonly ContextMenuActionLike[]>
}

/** Minimal service face matching `ctx.contextMenus` in DSH 0.2.2-rc.5+. */
export interface ContextMenusLike {
  register<K extends keyof GitWorktreeContextMenuTargetMap>(contribution: ContextMenuContributionLike<K>): () => void
}

/** Icon keys dispatched through `contextMenu.icon`. */
export const CONTEXT_MENU_ICON_KEYS = {
  create: 'git-worktree.create',
  checkoutPr: 'git-worktree.checkoutPr',
  manage: 'git-worktree.manage',
  remove: 'git-worktree.remove',
} as const

/** Order constants positioned cleanly against DSH built-in menu entries. */
export const CONTEXT_MENU_ORDER = {
  /** After `workspace.rename` (100) and `open-in-app.workspace` (200), before `workspace.delete` (300). */
  workspace: 250,
  /** After `session.id` (450) and `open-in-app.openWith` (500), before `session.archive` (600, afterContent). */
  session: 520,
  /** After `session-log-download.export` (100) and `open-in-app.openWith` (500), before `feedback` (600). */
  sessionHeader: 520,
} as const

export interface NativeContextMenusDeps {
  readonly contextMenus: ContextMenusLike
  readonly gitCache: WorkspaceGitCache
  readonly resolveSessionPath: (sessionId: string) => string | undefined
  readonly t: PropsLocale<'git-worktree'>['t']
  /** Additional reactive sources (e.g. `ctx.locale`, `ctx.sessions.list`, `ctx.workspaces.list`) when available. */
  readonly extraObservers?: readonly SnapshotObservable<unknown>[]
}

/**
 * Register native context menu contributions for workspaces, session rows, and
 * session headers. Returns a single disposer removing all three registrations.
 */
export function registerNativeContextMenus(deps: NativeContextMenusDeps): () => void {
  const { contextMenus, gitCache, resolveSessionPath, t } = deps
  const observers: readonly SnapshotObservable<unknown>[] = [
    gitCache,
    ...(deps.extraObservers ?? []),
  ]

  const resolveLinkedWorktreeSession = (sessionId: string): readonly ContextMenuActionLike[] => {
    const cwd = resolveSessionPath(sessionId)
    if (cwd === undefined) return []
    const facts = gitCache.get(cwd)
    if (facts === undefined) {
      void gitCache.syncPaths([cwd])
      return []
    }
    if (!isLinkedWorktreeFacts(facts)) return []
    return [{
      id: 'remove',
      label: t('contextMenu.removeWorktree'),
      icon: { key: CONTEXT_MENU_ICON_KEYS.remove },
      danger: true,
      separatorBefore: true,
      run: () => { openRemoveWorktree(cwd, facts.branch) },
    }]
  }

  const disposers = [
    contextMenus.register({
      id: 'git-worktree.workspace',
      target: 'workspace',
      order: CONTEXT_MENU_ORDER.workspace,
      observe: () => observers,
      resolve: ({ path }) => {
        const facts = gitCache.get(path)
        if (facts === undefined) {
          void gitCache.syncPaths([path])
          return []
        }
        if (facts === null) return []
        if (!facts.main) {
          return [{
            id: 'remove',
            label: t('contextMenu.removeWorktree'),
            icon: { key: CONTEXT_MENU_ICON_KEYS.remove },
            danger: true,
            separatorBefore: true,
            run: () => { openRemoveWorktree(path, facts.branch) },
          }]
        }
        return [
          {
            id: 'create',
            label: t('contextMenu.newWorktree'),
            icon: { key: CONTEXT_MENU_ICON_KEYS.create },
            separatorBefore: true,
            run: () => { openCreateWorktree(path, facts.repoName) },
          },
          {
            id: 'checkout-pr',
            label: t('contextMenu.checkoutPr'),
            icon: { key: CONTEXT_MENU_ICON_KEYS.checkoutPr },
            run: () => { openCheckoutPr(path, facts.repoName) },
          },
          {
            id: 'manage',
            label: t('contextMenu.manageWorktrees'),
            icon: { key: CONTEXT_MENU_ICON_KEYS.manage },
            run: () => { openManageWorktrees({ repoRoot: facts.repoRoot, repoName: facts.repoName }) },
          },
        ]
      },
    }),
    contextMenus.register({
      id: 'git-worktree.session',
      target: 'session',
      order: CONTEXT_MENU_ORDER.session,
      observe: () => observers,
      resolve: ({ sessionId }) => resolveLinkedWorktreeSession(sessionId),
    }),
    contextMenus.register({
      id: 'git-worktree.sessionHeader',
      target: 'sessionHeader',
      order: CONTEXT_MENU_ORDER.sessionHeader,
      observe: () => observers,
      resolve: ({ sessionId }) => resolveLinkedWorktreeSession(sessionId),
    }),
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}
