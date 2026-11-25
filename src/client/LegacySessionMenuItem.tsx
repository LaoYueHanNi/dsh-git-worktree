/**
 * Fallback session-menu entry for older DSH hosts (0.2.0-rc.1) that expose
 * `sidebar.workspaces.session.menu.item` without the structured `contextMenus`
 * service. Automatically unregistered on hosts where `ctx.contextMenus` is active.
 */

import { useSyncExternalStore } from 'react'
import { IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { openRemoveWorktree } from './action-bus.ts'
import { isLinkedWorktreeFacts, type WorkspaceGitCache } from './workspace-git-cache.ts'
import css from './LegacySessionMenuItem.module.css'

export interface LegacySessionMenuItemInjected {
  readonly gitCache: WorkspaceGitCache
  readonly resolveSessionPath: (sessionId: string) => string | undefined
}

export type LegacySessionMenuItemProps = LegacySessionMenuItemInjected & PropsLocale<'git-worktree'> & {
  readonly sessionId: string
  readonly useMenuOpenState?: () => readonly [boolean, (open: boolean) => void]
}

/** Render the guarded "Remove this worktree" button only for linked worktree sessions. */
export function LegacySessionMenuItem({
  sessionId,
  gitCache,
  resolveSessionPath,
  useMenuOpenState,
  t,
}: LegacySessionMenuItemProps) {
  const snapshot = useSyncExternalStore(gitCache.subscribe, gitCache.getSnapshot, gitCache.getSnapshot)
  const menuState = useMenuOpenState?.()
  const cwd = resolveSessionPath(sessionId)
  if (cwd === undefined) return null
  void snapshot
  const facts = gitCache.get(cwd)
  if (!isLinkedWorktreeFacts(facts)) return null

  return (
    <>
      <div className={css.separator} role="separator" />
      <button
        type="button"
        role="menuitem"
        className={css.item}
        onClick={() => {
          menuState?.[1](false)
          openRemoveWorktree(cwd, facts.branch)
        }}
      >
        <IconTrashOutlineRegular size={14} />
        <span>{t('contextMenu.removeWorktree')}</span>
      </button>
    </>
  )
}
