/**
 * Workspace / session / search row components transplanted from the native
 * `Rows.js` (injected props, no ctx). Hover swaps (folder→chevron, time→⋯)
 * are CSS-only. Drag wiring is intentionally omitted — P3.
 *
 * @module git-worktree/client/sidebar-rows
 */

import { useState, type ReactNode } from 'react'
import {
  HoverCard, IconArchiveOutline20, IconBranchOutline16, IconEditOutline16,
  IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16, IconPlusOutline16,
  IconTrashOutline16, IconTriangleRightFill14, Menu, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionNode } from './sidebar-groups.ts'
import { createdLabel, hoverTimeLabel, timeLabel, type SearchResultNode } from './sidebar-search.ts'
import css from './sidebar-rows.module.css'

type Translate = PropsLocale<'git-worktree'>['t']

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node: { blank: boolean; title: string }, t: Translate): string {
  return node.blank ? t('session.new') : node.title
}

/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({ label, cwd, createdAt, t }: {
  label: string
  cwd: string | undefined
  createdAt: number
  t: Translate
}): ReactNode {
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{label}</div>
      <div className={css.hoverPath}>{cwd}</div>
      <div className={css.hoverTime}>{createdLabel(createdAt, t)}</div>
    </div>
  )
}

/** Facts a project (workspace / repo-head) row needs. */
export interface ProjectRowModel {
  readonly key: string
  readonly label: string
  readonly expanded: boolean
  readonly containsCurrent: boolean
  readonly cwd?: string
  readonly createdAt?: number
}

/**
 * Project (workspace) header row: folder + title; hover reveals the chevron
 * and create button. `containsCurrent` is a derivation fact (no renderer scan).
 * Drag wiring is not transplanted (P3 — `useNativeDragAcceptance` stays vacant).
 */
export function ProjectRowItem({ row, onToggle, onCreate, actions, home, t, badge }: {
  row: ProjectRowModel
  onToggle: () => void
  onCreate?: () => void
  actions?: { rename: () => void; delete: () => void }
  home?: string | undefined
  t: Translate
  /** Aggregation-only count badge (repo group heads). */
  badge?: string
}): ReactNode {
  const active = row.expanded && row.containsCurrent
  const [menuOpen, setMenuOpen] = useState(false)
  const workspaceMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutline16 />, danger: true },
  ]
  const ownRow = (
    <div
      className={cx(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
    >
      <span className={cx(css.slot, css.folder, active && css.folderActive)}>
        {row.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      </span>
      <span className={cx(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cx(css.arrow, row.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{row.label}</span>
      </span>
      {badge !== undefined ? <span className={css.repoCount}>{badge}</span> : null}
      <span className={css.rowActions}>
        {actions !== undefined && (
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id !== 'rename' && id !== 'delete') return
              if (id === 'rename') actions.rename()
              else actions.delete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.workspace.aria', { name: row.label })}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(v => !v)
                }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        )}
        {onCreate !== undefined && (
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('actions.newSession.aria', { name: row.label })}
            onClick={(e) => {
              e.stopPropagation()
              onCreate()
            }}
          >
            <IconPlusOutline16 />
          </button>
        )}
      </span>
    </div>
  )
  if (row.createdAt === undefined) return ownRow
  return (
    <HoverCard
      anchor={ownRow}
      content={(
        <WorkspaceHoverContent
          label={row.label}
          cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
          createdAt={row.createdAt}
          t={t}
        />
      )}
      disabled={menuOpen}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

/** Session status presentation; pending interaction is primary and live activity outranks completion. */
export function sessionStatuses(node: {
  pendingInteraction?: SessionNode['pendingInteraction']
  running: boolean
  runningSubagentCount: number
  completed: boolean
}, t: Translate): ReadonlyArray<{ state: 'done' | 'warning' | 'ongoing'; label: string }> {
  const subagents = node.runningSubagentCount === 0 ? undefined : {
    state: 'ongoing' as const,
    label: t(node.runningSubagentCount === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other', { n: node.runningSubagentCount }),
  }
  let pending: { state: 'warning'; label: string } | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'warning', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer') }
      break
    case undefined:
      break
    default:
      return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary = { state: 'ongoing' as const, label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

/** Primary status dot plus every status's screen-reader label. */
function SessionStatusDots({ statuses }: { statuses: ReturnType<typeof sessionStatuses> }): ReactNode {
  const primary = statuses[0]
  if (primary === undefined) return null
  return (
    <>
      <StateDot state={primary.state} />
      {statuses.map(status => (
        <span key={status.label} className={css.visuallyHidden}>{status.label}</span>
      ))}
    </>
  )
}

/** Hover-card body: full title, relative time, and every relevant live status. */
function SessionHoverContent({ node, now, t }: { node: SessionNode; now: number; t: Translate }): ReactNode {
  const statuses = sessionStatuses(node, t)
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {!node.blank && <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>}
      {statuses.map(status => (
        <div key={status.label} className={css.hoverStatus}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
    </div>
  )
}

/** One flat search result: title, Workspace context, and optional content excerpt. */
export function SearchResultItem({ result, currentId, onOpen, t }: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: string) => void
  t: Translate
}): ReactNode {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  return (
    <button
      type="button"
      className={cx(css.searchResultRow, selected && css.selected)}
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(result.id) }}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          {primaryStatus !== undefined && (primaryStatus.state !== 'done' || result.completed) && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{result.title}</span>
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </button>
  )
}

/**
 * One 32px session row: status dot, title, relative time, hover ⋯ menu.
 * Drag wiring is not transplanted (P3).
 */
export function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, flat = false, t }: {
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen: (id: string) => void
  onRename: (id: string, currentTitle: string) => void
  onFork: (id: string) => void
  onArchive: (id: string) => void
  flat?: boolean
  t: Translate
}): ReactNode {
  const title = displayTitle(node, t)
  const selected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const showStatus = (statuses[0]?.state !== 'done') || node.completed
  const [menuOpen, setMenuOpen] = useState(false)
  const sessionMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutline16 /> },
    { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> },
  ]
  return (
    <HoverCard
      anchor={(
        <div
          className={cx(
            css.sessionRow,
            selected && css.selected,
            menuOpen && css.menuOpen,
            flat && !showStatus && css.flatSessionRowWithoutStatus,
          )}
          role="treeitem"
          aria-selected={selected}
          onClick={() => { onOpen(node.id) }}
        >
          {(!flat || showStatus) && (
            <span className={css.slot}>
              {showStatus && <SessionStatusDots statuses={statuses} />}
            </span>
          )}
          <span className={css.title}>{title}</span>
          {!node.blank && <span className={css.time}>{timeLabel(node.updatedAt, now, t)}</span>}
          {!node.blank && (
            <span className={css.rowActions}>
              <Menu
                open={menuOpen}
                onClose={() => { setMenuOpen(false) }}
                items={sessionMenuItems}
                onSelect={(id) => {
                  setMenuOpen(false)
                  if (id === 'rename') onRename(node.id, node.title)
                  if (id === 'fork') onFork(node.id)
                  if (id === 'archive') onArchive(node.id)
                }}
                portal
                closeOnPointerLeave
                anchor={(
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('actions.session.aria', { name: title })}
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(v => !v)
                    }}
                  >
                    <IconEllipsisOutline16 />
                  </button>
                )}
              />
            </span>
          )}
        </div>
      )}
      content={<SessionHoverContent node={node} now={now} t={t} />}
      disabled={menuOpen}
      copyText={node.blank ? undefined : node.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
