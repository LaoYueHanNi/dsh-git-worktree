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
import { isLinkedWorktreeFacts, type SnapshotObservable, type WorkspaceGitCache } from './workspace-git-cache.ts'
import css from './SidebarWorktreeBadge.module.css'

export interface SidebarWorktreeBadgeInjected {
  readonly gitCache: WorkspaceGitCache
  readonly resolveSessionPath: (sessionId: string) => string | undefined
  /**
   * Optional reactive sessions observable so session-level decorations
   * immediately re-evaluate when `workingDirectory` or official `forgeWorktree`
   * projections arrive after the first turn.
   */
  readonly sessionsObservable?: SnapshotObservable<unknown> | undefined
  /**
   * Optional scope filter returning true when session-level worktree
   * decoration applies (for example, yielding to sessions already decorated by
   * official `forgeWorktree`).
   */
  readonly shouldDecorateSession?: (sessionId: string, effectivePath: string) => boolean
}

export type SidebarWorktreeBadgeProps = SidebarWorktreeBadgeInjected & PropsLocale<'git-worktree'> & {
  readonly sessionId: string
}

const NOOP_SUBSCRIBE = () => () => {}
const NOOP_SNAPSHOT = () => undefined

function useLinkedWorktreeFacts(
  sessionId: string,
  gitCache: WorkspaceGitCache,
  resolvePath: (id: string) => string | undefined,
  sessionsObservable?: SnapshotObservable<unknown>,
  shouldDecorateSession?: (sessionId: string, effectivePath: string) => boolean,
): WorkspaceGitFacts | null {
  const snapshot = useSyncExternalStore(gitCache.subscribe, gitCache.getSnapshot, gitCache.getSnapshot)
  const sessionsSnapshot = useSyncExternalStore(
    sessionsObservable?.subscribe ?? NOOP_SUBSCRIBE,
    sessionsObservable?.getSnapshot ?? NOOP_SNAPSHOT,
    sessionsObservable?.getSnapshot ?? NOOP_SNAPSHOT,
  )
  void snapshot
  void sessionsSnapshot
  const cwd = resolvePath(sessionId)
  if (cwd === undefined) return null
  if (shouldDecorateSession !== undefined && !shouldDecorateSession(sessionId, cwd)) return null
  const facts = gitCache.get(cwd)
  return isLinkedWorktreeFacts(facts) ? facts : null
}

/** Subtle non-interactive branch marker shown in `sidebar.session.row.trailing` for worktree sessions. */
export function SidebarWorktreeTrailing({ sessionId, gitCache, resolveSessionPath, sessionsObservable, shouldDecorateSession, t }: SidebarWorktreeBadgeProps) {
  const facts = useLinkedWorktreeFacts(sessionId, gitCache, resolveSessionPath, sessionsObservable, shouldDecorateSession)
  if (facts === null) return null
  const label = facts.branch !== null
    ? t('sidebar.worktreeBadgeWithBranch', { repo: facts.repoName, branch: facts.branch })
    : t('sidebar.worktreeBadge', { repo: facts.repoName })
  return (
    <span className={css.trailingBadge} role="img" aria-label={label} title={label}>
      <IconBranchOutlineRegular size={13} />
    </span>
  )
}

/** Worktree branch and base-branch detail shown inside `sidebar.session.row.hover` (mounted only while hovered). */
export function SidebarWorktreeHover({ sessionId, gitCache, resolveSessionPath, sessionsObservable, shouldDecorateSession, t }: SidebarWorktreeBadgeProps) {
  const facts = useLinkedWorktreeFacts(sessionId, gitCache, resolveSessionPath, sessionsObservable, shouldDecorateSession)
  if (facts === null) return null
  const baseLabel = facts.baseBranch !== undefined && facts.baseBranch !== '' && facts.baseBranch !== facts.branch
    ? facts.baseBranch
    : undefined
  const isPrLabel = baseLabel !== undefined && /^(?:PR #\d+|MR !\d+)/.test(baseLabel)
  const note = baseLabel === undefined
    ? t('sidebar.worktreeHoverLabel')
    : isPrLabel
      ? t('sidebar.worktreeHoverPr', { label: baseLabel })
      : t('sidebar.worktreeHoverFrom', { base: baseLabel })
  return (
    <div className={css.hoverItem}>
      <span className={css.hoverIcon} aria-hidden="true">
        <IconBranchOutlineRegular size={12} />
      </span>
      <span className={css.hoverBody}>
        {facts.branch !== null && <span className={css.hoverBranch}>{facts.branch}</span>}
        <span className={css.hoverNote}>{note}</span>
      </span>
    </div>
  )
}
