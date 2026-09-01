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
  IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16,
  IconPlusOutline16, IconTrashOutline16, IconTriangleRightFill14, Menu, StateDot,
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
  actions?: { rename: () => void; delete: () => void; removeWorktree?: () => void }
  home?: string | undefined
  t: Translate
  /** Aggregation-only count badge (repo group heads). */
  badge?: string
}): ReactNode {
  const active = row.expanded && row.containsCurrent
  const [menuOpen, setMenuOpen] = useState(false)
  // The worktree entry stays absent on non-linked rows and on linked rows the
  // sidebar holds occupied (a running or currently-browsed session) — the
  // affordance appears exactly where removal is safe to offer.
  const workspaceMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    ...(actions?.removeWorktree !== undefined
      ? [{ id: 'removeWorktree', label: t('worktreeRemove.menu'), icon: <IconTrashOutline16 />, danger: true }]
      : []),
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
              if (id === 'rename') actions.rename()
              else if (id === 'removeWorktree') actions.removeWorktree?.()
              else if (id === 'delete') actions.delete()
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

/** Final path segment of an absolute directory ('' for the unknown-cwd cluster). */
function pathBasename(path: string): string {
  if (path === '') return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/**
 * Dashed folder glyph for virtual (unregistered) directory rows. The icon set
 * ships no dashed variant, so this follows the WorktreeCheck precedent of a
 * module-local SVG: at 16px a dash pattern is a far stronger "directory-shaped
 * but not a registered workspace" mark than the outline/solid stroke contrast
 * it replaces.
 */
function StrayFolderGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.75 4.4c0-.91.71-1.65 1.6-1.65h2.47c.45 0 .88.19 1.19.52l.79.86h4.85c.89 0 1.6.74 1.6 1.65v6.05c0 .91-.71 1.65-1.6 1.65H3.35c-.89 0-1.6-.74-1.6-1.65Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeDasharray="2 1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * One virtual directory row of the stray (Ungrouped) section: DASHED folder
 * (the real workspace rows' folder is solid — the dash pattern is the
 * at-a-glance "this directory is not a registered workspace" mark) +
 * directory basename + session-count badge; hover reveals the full path and,
 * when a registered workspace holds the directory, that ownership (the
 * sessions are its strays). The ⋯ menu exists only where registering the
 * directory as a real workspace is possible; owned clusters carry no action
 * yet (re-adoption is a later feature).
 */
export function StrayGroupRow({ path, belongsTo, count, expanded, onToggle, onRegister, registering, home, t }: {
  path: string
  /** Registered workspace title holding this directory; undefined = unregistered. */
  belongsTo: string | undefined
  count: number
  expanded: boolean
  onToggle: () => void
  /** Present only while the directory has no registered workspace. */
  onRegister?: () => void
  registering?: boolean
  home?: string | undefined
  t: Translate
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const label = path === '' ? t('stray.unknown') : pathBasename(path)
  const canRegister = onRegister !== undefined
  const items = canRegister
    ? [{ id: 'register', label: t('stray.register'), icon: <IconFolderOpen16 /> }]
    : []
  const row = (
    <div
      className={cx(css.projectRow, css.strayRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {/* One steady dashed glyph for both states: the chevron carries
       * expand/collapse, the dash pattern stays the virtual-row mark. */}
      <span className={cx(css.slot, css.folder)}>
        <StrayFolderGlyph />
      </span>
      <span className={cx(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={cx(css.arrow, expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.repoCount}>{String(count)}</span>
      {canRegister && (
        <span className={css.rowActions}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={items}
            onSelect={() => {
              setMenuOpen(false)
              onRegister?.()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('stray.register.aria', { name: label })}
                disabled={registering === true}
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
  )
  return (
    <HoverCard
      anchor={row}
      content={(
        <div className={css.hoverContent}>
          <div className={css.hoverTitle}>{label}</div>
          {path !== '' && <div className={css.hoverPath}>{abbreviateHomePath(path, home)}</div>}
          {belongsTo !== undefined && <div className={css.hoverStatus}>{t('stray.belongsTo', { name: belongsTo })}</div>}
        </div>
      )}
      disabled={menuOpen}
      copyText={path === '' ? undefined : path}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
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
