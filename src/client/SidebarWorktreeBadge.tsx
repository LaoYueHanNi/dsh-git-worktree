/**
 * Native sidebar decorations for linked worktree sessions (DSH 0.2.2-rc.5+):
 * - `SidebarWorktreeTrailing` renders a subtle branch icon in `sidebar.session.row.trailing`
 * - `SidebarWorktreeHover` renders repository + branch identity in `sidebar.session.row.hover`
 *
 * Non-worktree sessions (main checkouts and non-git directories) return null so
 * ordinary sidebar rows stay completely untouched.
 */

import { useSyncExternalStore } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitFacts } from '../wire.ts'
import { isLinkedWorktreeFacts, type WorkspaceGitCache } from './workspace-git-cache.ts'
import css from './SidebarWorktreeBadge.module.css'

export interface SidebarWorktreeBadgeInjected {
  readonly gitCache: WorkspaceGitCache
  readonly resolveSessionPath: (sessionId: string) => string | undefined
}

export type SidebarWorktreeBadgeProps = SidebarWorktreeBadgeInjected & PropsLocale<'git-worktree'> & {
  readonly sessionId: string
}

function useLinkedWorktreeFacts(
  sessionId: string,
  gitCache: WorkspaceGitCache,
  resolvePath: (id: string) => string | undefined,
): WorkspaceGitFacts | null {
  const snapshot = useSyncExternalStore(gitCache.subscribe, gitCache.getSnapshot, gitCache.getSnapshot)
  const cwd = resolvePath(sessionId)
  if (cwd === undefined) return null
  // Read through `gitCache.get` after subscribing to `snapshot` so path normalization stays in one place.
  void snapshot
  const facts = gitCache.get(cwd)
  return isLinkedWorktreeFacts(facts) ? facts : null
}

/** Subtle non-interactive branch marker shown in `sidebar.session.row.trailing` for worktree sessions. */
export function SidebarWorktreeTrailing({ sessionId, gitCache, resolveSessionPath, t }: SidebarWorktreeBadgeProps) {
  const facts = useLinkedWorktreeFacts(sessionId, gitCache, resolveSessionPath)
  if (facts === null) return null
  const label = facts.branch !== null
    ? t('sidebar.worktreeBadgeWithBranch', { repo: facts.repoName, branch: facts.branch })
    : t('sidebar.worktreeBadge', { repo: facts.repoName })
  return (
    <span className={css.trailingBadge} role="img" aria-label={label} title={label}>
      <IconBranchOutlineRegular size={12} />
    </span>
  )
}

/** Worktree repository and branch detail shown inside `sidebar.session.row.hover` (mounted only while hovered). */
export function SidebarWorktreeHover({ sessionId, gitCache, resolveSessionPath, t }: SidebarWorktreeBadgeProps) {
  const facts = useLinkedWorktreeFacts(sessionId, gitCache, resolveSessionPath)
  if (facts === null) return null
  const label = facts.branch !== null
    ? t('sidebar.worktreeHoverWithBranch', { repo: facts.repoName, branch: facts.branch })
    : t('sidebar.worktreeHover', { repo: facts.repoName })
  return (
    <div className={css.hoverRow}>
      <span className={css.hoverIcon} aria-hidden="true">
        <IconBranchOutlineRegular size={13} />
      </span>
      <span className={css.hoverLabel}>{label}</span>
    </div>
  )
}
