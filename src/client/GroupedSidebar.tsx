/**
 * GroupedSidebar: the `sidebar.workspaces` seat occupant. P1 aggregation
 * (same-repository workspaces clustered from /group facts) plus a 1:1
 * transplant of the native workspace browser's search, menus, status dots,
 * relative time, view options, rail, and dialogs.
 *
 * Drag-reorder and the native `dsh.workspace.view.v5` store are P3. Adding a
 * workspace uses `uiWorkspace.pickDirectory` rather than re-declaring the
 * `sidebar.workspaces.directoryFlow` child hole (native already declared it;
 * a second declarer throws).
 *
 * @module git-worktree/client/GroupedSidebar
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  Button, IconCloseFill14, IconPersonalizationOutline16, IconProjectAddOutline16,
  IconSearchOutline16, Menu, Modal, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { OwnerOf, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitFacts } from '../wire.ts'
import {
  deriveFlat, deriveSidebarGroups, deriveStrayGroups, factsForSignature, indexSubagentRunning, loadExpandState, loadFactsCache, loadViewPrefs,
  orderedVisibleSessionIds, saveExpandState, saveFactsCache, saveViewPrefs, sessionNode,
  type SessionListLike, type SessionNode, type SidebarGroup, type SidebarGroupBy,
  type SidebarMember, type SidebarOrderBy, type StrayGroup, type WorkspaceLike,
} from './sidebar-groups.ts'
import {
  COLLAPSED_SESSION_LIMIT, EXPAND_SLIDE_MS, SEARCH_DEBOUNCE_MS, SEARCH_QUERY_MAX_CODE_UNITS,
  deriveSearchResults, sanitizeSearchQuery, type ContentSearchHit,
} from './sidebar-search.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem, StrayGroupRow } from './sidebar-rows.tsx'
import { PickFlowController } from './pick-flow.ts'
import css from './GroupedSidebar.module.css'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

/** Observable snapshot (getSnapshot + subscribe) used for host description / flow occupancy. */
export interface SidebarObservable<T> {
  readonly getSnapshot: () => T
  readonly subscribe: (listener: () => void) => () => void
}

/** The business face this entry injects; the component never touches ctx. */
export interface GroupedSidebarInjected {
  readonly workspacesList: SidebarObservable<WorkspaceSnapshot>
  readonly sessionsList: SidebarObservable<SessionListState>
  readonly openSession: (sessionId: string) => void
  readonly startSession: (workspaceId?: string) => void
  readonly loadFacts: (paths: readonly string[]) =>
    Promise<Readonly<Record<string, WorkspaceGitFacts | null>> | undefined>
  readonly searchSessions: (query: string, signal: AbortSignal) => Promise<{
    items: readonly ContentSearchHit[]
    hasMore: boolean
  }>
  readonly searchResultLimit: number
  readonly renameSession: (sessionId: string, title: string) => Promise<void>
  readonly forkSession: (sessionId: string) => void
  readonly renameWorkspace: (workspaceId: string, title: string) => Promise<void>
  readonly deleteWorkspace: (workspaceId: string) => Promise<void>
  readonly archiveSession: (sessionId: string) => Promise<void>
  /** Pre-delete facts of one linked worktree folder (dirty + ahead counts). */
  readonly inspectWorktree: (path: string) => Promise<{ dirty: number; ahead: number | undefined }>
  /** Remove one linked worktree (git registration + folder); rejects with the host error text. */
  readonly removeWorktree: (path: string, force: boolean) => Promise<void>
  /** Batch directory-existence probe; `rebuildable` marks missing paths the
   * host confirmed as worktree storage slots. undefined = the probe itself
   * failed (every action withheld — the client must not guess). */
  readonly probeDirectories: (paths: readonly string[]) => Promise<{
    exists: Readonly<Record<string, boolean>>
    rebuildable?: Readonly<Record<string, boolean>>
  } | undefined>
  /** Rebuild a missing worktree storage slot (`mkdir -p`, host-gated to the
   * storage root); rejects with the host error text. */
  readonly ensureDirectory: (path: string) => Promise<void>
  readonly createWorkspace: (input: { path: string }) => Promise<{ workspaceId: string }>
  readonly pickDirectory: () => Promise<string | null>
  /** Host account home (the native `hostInfo` inject hook's shape; the
   * snapshot always stands, `home` absent until the first ready frame). */
  readonly hostInfo: SidebarObservable<{ home: string | undefined }>
  readonly directoryFlow: SidebarObservable<boolean>
  /**
   * This mount can paint the grouped tree (a matching facts cache counts)
   * or the first /group attempt has settled. The settings card spinner
   * waits on this so it does not hide while a cache-miss still looks like
   * the native flat list.
   */
  readonly onReady?: () => void
}

export type GroupedSidebarProps =
  PropsRuntime<'sidebar.workspaces'>
  & OwnerOf<'sidebar.workspaces'>
  & PropsLocale<'git-worktree'>
  & GroupedSidebarInjected

type FactsState = { signature: string; facts: Readonly<Record<string, WorkspaceGitFacts | null>> } | null
type Translate = PropsLocale<'git-worktree'>['t']

function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
  groupBy: SidebarGroupBy
  orderBy: SidebarOrderBy
  onGroupPick: (mode: SidebarGroupBy) => void
  onOrderPick: (mode: SidebarOrderBy) => void
  t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label', id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator', id: 'order-by-separator' },
        { type: 'label', id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ]}
      selectedIds={[groupBy, orderBy]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={cx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** Add-workspace flow: OS directory picker (cannot redeclare native's directoryFlow hole). */
function WorkspacePickFlow({ open, onClose, onRetry, pickDirectory, createWorkspace, onPick, t }: {
  open: boolean
  onClose: () => void
  onRetry: () => void
  pickDirectory: () => Promise<string | null>
  createWorkspace: (input: { path: string }) => Promise<{ workspaceId: string }>
  onPick: (workspaceId: string) => void
  t: Translate
}): ReactNode {
  const [errorOpen, setErrorOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  // The controller is the flow's edge-triggered core: re-renders refresh the
  // hooks below but can never re-launch the chooser (only a closed→open edge
  // starts a run, and a falling edge/kill discards whatever is in flight).
  const controllerRef = useRef<PickFlowController | null>(null)
  const controller = controllerRef.current ?? (controllerRef.current = new PickFlowController())
  controller.attach({
    pickDirectory,
    createWorkspace,
    onPicked: onPick,
    onCancelled: onClose,
    onFailed: (message) => {
      setModalError(message)
      setErrorOpen(true)
      onClose()
    },
  })
  useEffect(() => { controller.sync(open) }, [open, controller])
  useEffect(() => () => { controller.kill() }, [controller])
  const closeModal = (): void => {
    setErrorOpen(false)
    setModalError(null)
  }
  return (
    <Modal
      open={errorOpen}
      onClose={closeModal}
      closeLabel={t('close')}
      title={t('folderError.title')}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={closeModal}>{t('cancel')}</Button>
          <Button
            variant="primary"
            className={css.modalAction}
            onClick={() => {
              closeModal()
              onRetry()
            }}
          >
            {t('folderError.retry')}
          </Button>
        </>
      )}
    >
      <div className={css.modalError} role="alert">{modalError}</div>
    </Modal>
  )
}

function SearchResults({ list, workspaces, archivedSessionIds, query, remote, resultLimit, currentId, onOpen, t }: {
  list: SessionListLike
  workspaces: readonly WorkspaceLike[]
  archivedSessionIds: readonly string[]
  query: string
  remote: { query: string; status: 'idle' | 'loading' | 'ready' | 'error'; items: readonly ContentSearchHit[]; hasMore: boolean }
  resultLimit: number
  currentId: string | undefined
  onOpen: (id: string) => void
  t: Translate
}): ReactNode {
  const currentRemote = remote.query === query ? remote : { query, status: 'loading' as const, items: [] as const, hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'
  return (
    <div className={cx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem key={result.id} result={result} currentId={currentId} onOpen={onOpen} t={t} />
          ))}
        </div>
        {pending && <div className={css.searchStatus} role="status">{t('search.pending')}</div>}
        {failed && <div className={css.searchWarning} role="status">{t('search.unavailable')}</div>}
        {!pending && results.items.length === 0 && <div className={css.empty}>{t('search.noMatches')}</div>}
        {results.hasMore && <div className={css.searchStatus}>{t('search.hasMore', { n: resultLimit })}</div>}
      </div>
      <span className={css.fade} />
    </div>
  )
}

function FlatListBody({ list, archivedSessionIds, orderBy, currentId, now, onOpen, onRename, onFork, onArchive, t }: {
  list: SessionListLike
  archivedSessionIds: readonly string[]
  orderBy: SidebarOrderBy
  currentId: string | undefined
  now: number
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onFork: (id: string) => void
  onArchive: (id: string) => void
  t: Translate
}): ReactNode {
  const rows = useMemo(() => deriveFlat(list, archivedSessionIds, orderBy), [list, archivedSessionIds, orderBy])
  return (
    <div className={cx(css.treeBody, css.wide)}>
      <div className={cx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {rows.map(node => (
          <SessionNodeItem
            key={node.id}
            node={node}
            currentId={currentId}
            now={now}
            onOpen={onOpen}
            onRename={onRename}
            onFork={onFork}
            onArchive={onArchive}
            flat
            t={t}
          />
        ))}
      </div>
      <span className={css.fade} />
    </div>
  )
}

function memberLabel(member: SidebarMember, t: Translate): string {
  if (member.label.type === 'main') {
    return member.label.branch === null ? t('sidebarMain') : t('sidebarMainBranch', { branch: member.label.branch })
  }
  if (member.label.type === 'linked') {
    return member.label.branch ?? member.workspace.title
  }
  return member.workspace.title
}

function createdAtMs(createdAt: string | undefined): number | undefined {
  if (createdAt === undefined || createdAt === '') return undefined
  const parsed = Date.parse(createdAt)
  return Number.isNaN(parsed) ? undefined : parsed
}

function GroupedTree({ groups, footer, sessions, archived, currentSessionId, expandMap, onToggle, expandTo, orderBy, now, home, onOpen, onRename, onFork, onArchive, onWorkspaceRename, onWorkspaceDelete, onWorktreeRemove, startSession, t }: {
  groups: readonly SidebarGroup[]
  /** Tail section rendered inside the same scroll container (the stray cluster). */
  footer?: ReactNode
  sessions: SessionListLike
  archived: readonly string[]
  currentSessionId: string | undefined
  expandMap: Record<string, boolean>
  onToggle: (key: string) => void
  expandTo: (key: string) => void
  orderBy: SidebarOrderBy
  now: number
  home: string | undefined
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onFork: (id: string) => void
  onArchive: (id: string) => void
  onWorkspaceRename: (workspaceId: string, title: string) => void
  onWorkspaceDelete: (workspaceId: string, title: string) => void
  onWorktreeRemove: (member: SidebarMember) => void
  startSession: (workspaceId?: string) => void
  t: Translate
}): ReactNode {
  const descendants = useMemo(() => indexSubagentRunning(sessions.byId), [sessions.byId])
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  const empty = groups.length === 0
  return (
    <div className={cx(css.treeBody, css.wide)}>
      <div className={css.list} role="tree" aria-label={t('section.workspaces')}>
        {empty && <div className={css.empty}>{t('empty.none')}</div>}
        {groups.map((group) => {
          if (group.kind === 'repo') {
            const memberIds = group.members.map(member => orderedVisibleSessionIds(member.workspace, sessions, archived, orderBy))
            const visibleCount = memberIds.reduce((sum, ids) => sum + ids.length, 0)
            const containsCurrent = group.members.some(member => member.workspace.sessionIds.includes(currentSessionId ?? '\0'))
            const open = expandMap[group.key] ?? containsCurrent
            return (
              <div key={group.key} className={css.groupSection}>
                <ProjectRowItem
                  row={{ key: group.key, label: group.repoName ?? group.key, expanded: open, containsCurrent }}
                  onToggle={() => { onToggle(group.key) }}
                  home={home}
                  t={t}
                  badge={String(visibleCount)}
                />
                {open && group.members.map((member, index) => (
                  <MemberBlock
                    key={member.workspace.workspaceId}
                    member={member}
                    indent
                    sessionIds={memberIds[index] ?? []}
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    expandMap={expandMap}
                    onToggle={onToggle}
                    expandTo={expandTo}
                    descendants={descendants}
                    expandedSessionGroups={expandedSessionGroups}
                    setExpandedSessionGroups={setExpandedSessionGroups}
                    now={now}
                    home={home}
                    onOpen={onOpen}
                    onRename={onRename}
                    onFork={onFork}
                    onArchive={onArchive}
                    onWorkspaceRename={onWorkspaceRename}
                    onWorkspaceDelete={onWorkspaceDelete}
                    onWorktreeRemove={onWorktreeRemove}
                    startSession={startSession}
                    t={t}
                  />
                ))}
              </div>
            )
          }
          const member = group.members[0]
          if (member === undefined) return null
          return (
            <div key={group.key} className={css.groupSection}>
              <MemberBlock
                member={member}
                indent={false}
                sessionIds={orderedVisibleSessionIds(member.workspace, sessions, archived, orderBy)}
                sessions={sessions}
                currentSessionId={currentSessionId}
                expandMap={expandMap}
                onToggle={onToggle}
                expandTo={expandTo}
                descendants={descendants}
                expandedSessionGroups={expandedSessionGroups}
                setExpandedSessionGroups={setExpandedSessionGroups}
                now={now}
                home={home}
                onOpen={onOpen}
                onRename={onRename}
                onFork={onFork}
                onArchive={onArchive}
                onWorkspaceRename={onWorkspaceRename}
                onWorkspaceDelete={onWorkspaceDelete}
                onWorktreeRemove={onWorktreeRemove}
                startSession={startSession}
                t={t}
              />
            </div>
          )
        })}
        {footer}
      </div>
      <span className={css.fade} />
    </div>
  )
}

function MemberBlock({ member, indent, sessionIds, sessions, currentSessionId, expandMap, onToggle, expandTo, descendants, expandedSessionGroups, setExpandedSessionGroups, now, home, onOpen, onRename, onFork, onArchive, onWorkspaceRename, onWorkspaceDelete, onWorktreeRemove, startSession, t }: {
  member: SidebarMember
  indent: boolean
  sessionIds: readonly string[]
  sessions: SessionListLike
  currentSessionId: string | undefined
  expandMap: Record<string, boolean>
  onToggle: (key: string) => void
  expandTo: (key: string) => void
  descendants: ReturnType<typeof indexSubagentRunning>
  expandedSessionGroups: readonly string[]
  setExpandedSessionGroups: (update: (keys: string[]) => string[]) => void
  now: number
  home: string | undefined
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onFork: (id: string) => void
  onArchive: (id: string) => void
  onWorkspaceRename: (workspaceId: string, title: string) => void
  onWorkspaceDelete: (workspaceId: string, title: string) => void
  onWorktreeRemove: (member: SidebarMember) => void
  startSession: (workspaceId?: string) => void
  t: Translate
}): ReactNode {
  const key = `ws:${member.workspace.workspaceId}`
  const containsCurrent = member.workspace.sessionIds.includes(currentSessionId ?? '\0')
  const open = expandMap[key] ?? containsCurrent
  const label = memberLabel(member, t)
  const overflowOpen = expandedSessionGroups.includes(key)
  const visibleIds = overflowOpen ? sessionIds : sessionIds.slice(0, COLLAPSED_SESSION_LIMIT)
  const nodes: SessionNode[] = []
  for (const sessionId of visibleIds) {
    const summary = sessions.byId[sessionId]
    if (summary !== undefined) nodes.push(sessionNode(summary, descendants))
  }
  const created = createdAtMs(member.workspace.createdAt)
  // Removal is offered only on linked worktrees the sidebar holds FREE: a
  // running session's cwd is about to vanish (its failure would surface
  // mid-task), and the currently-browsed session's directory disappearing
  // under it is the same hole. Occupied rows simply don't show the action —
  // archive or switch away first, then remove.
  const hasRunning = member.workspace.sessionIds.some(id => sessions.byId[id]?.running === true)
  const occupied = containsCurrent || hasRunning
  const canRemoveWorktree = member.label.type === 'linked' && !occupied
  const body = (
    <>
      <ProjectRowItem
        row={{
          key,
          label,
          expanded: open,
          containsCurrent,
          cwd: member.workspace.path,
          ...created === undefined ? {} : { createdAt: created },
        }}
        onToggle={() => { onToggle(key) }}
        onCreate={() => {
          expandTo(key)
          startSession(member.workspace.workspaceId)
        }}
        actions={{
          rename: () => { onWorkspaceRename(member.workspace.workspaceId, member.workspace.title) },
          delete: () => { onWorkspaceDelete(member.workspace.workspaceId, member.workspace.title) },
          ...canRemoveWorktree ? { removeWorktree: () => { onWorktreeRemove(member) } } : {},
        }}
        home={home}
        t={t}
      />
      {open && (
        <div className={indent ? css.sessionsIndent : undefined}>
          {nodes.map(node => (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={currentSessionId}
              now={now}
              onOpen={onOpen}
              onRename={onRename}
              onFork={onFork}
              onArchive={onArchive}
              t={t}
            />
          ))}
          {sessionIds.length > COLLAPSED_SESSION_LIMIT && (
            <button
              type="button"
              className={css.sessionOverflowButton}
              aria-expanded={overflowOpen}
              onClick={() => {
                setExpandedSessionGroups(keys => keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key])
              }}
            >
              {overflowOpen ? t('sessions.collapse') : t('sessions.expand', { n: sessionIds.length - COLLAPSED_SESSION_LIMIT })}
            </button>
          )}
        </div>
      )}
    </>
  )
  return indent ? <div className={css.memberIndent}>{body}</div> : body
}

export function GroupedSidebar(props: GroupedSidebarProps): ReactNode {
  const { t } = props
  const workspaces = useSyncExternalStore(props.workspacesList.subscribe, props.workspacesList.getSnapshot)
  const sessions = useSyncExternalStore(props.sessionsList.subscribe, props.sessionsList.getSnapshot)
  const host = useSyncExternalStore(props.hostInfo.subscribe, props.hostInfo.getSnapshot)
  const directoryFlowAvailable = useSyncExternalStore(props.directoryFlow.subscribe, props.directoryFlow.getSnapshot)
  const items = workspaces.items as readonly WorkspaceLike[]
  const home = host?.home

  const signature = useMemo(() => [...items].map(item => item.path).sort().join('\n'), [items])
  // Facts follow the path signature, not the mount instant: the first render
  // is usually an empty pending list (signature ""), so a useState
  // initializer would miss the cache and never re-read it. Re-read whenever
  // the signature changes; a matching batch paints the grouped tree on THAT
  // frame, then the fresh probe refreshes underneath.
  const cachedBatch = useMemo(() => loadFactsCache(), [signature])
  const [factsState, setFactsState] = useState<FactsState>(null)
  const factsEntry = factsForSignature(signature, factsState, cachedBatch)
  const facts = factsEntry?.facts
  const hasFactsForSignature = factsEntry !== null
  const readyOnce = useRef(false)
  const signalReady = (): void => {
    if (readyOnce.current) return
    readyOnce.current = true
    props.onReady?.()
  }
  /** Signatures this mount already sent a probe for (once per signature). */
  const probedSignature = useRef<string | undefined>(undefined)
  useEffect(() => {
    // Already probed for this signature (or the empty list proved truly
    // empty): nothing left to do but report readiness.
    if (probedSignature.current === signature) {
      signalReady()
      return
    }
    // The workspace baseline has not landed yet (phase pending, empty list):
    // probe nothing — the real items arrive through the subscription and
    // this effect reruns with the real signature.
    if (items.length === 0) {
      if (workspaces.phase === 'ready') {
        probedSignature.current = signature
        signalReady()
      }
      return
    }
    // A cached (or already-live) batch covers this signature: it paints the
    // grouped tree NOW, so readiness reports immediately while the fresh
    // probe still runs underneath.
    if (hasFactsForSignature) signalReady()
    let live = true
    void props.loadFacts(items.map(item => item.path)).then(
      (facts) => {
        if (!live) return
        // The signature is marked probed only once the probe SETTLES, so a
        // StrictMode mount→cleanup→remount replay (first probe dropped by
        // the cleanup) re-issues it instead of leaving the tree on stale
        // facts forever.
        probedSignature.current = signature
        if (facts !== undefined) {
          setFactsState({ signature, facts })
          saveFactsCache({ signature, facts })
        }
        // A failed probe keeps whatever rendered (the cached batch, or the
        // degraded flat list). probedSignature is still set: a later
        // sessions-only snapshot must not re-issue /group (that used to
        // hammer git on every rename). A new path signature or a remount
        // retries.
        signalReady()
      },
      () => {
        if (!live) return
        probedSignature.current = signature
        signalReady()
      },
    )
    return () => { live = false }
  }, [signature, items, props.loadFacts, workspaces.phase, hasFactsForSignature])

  const groups = useMemo(() => deriveSidebarGroups(items, facts), [items, facts])
  const sessionList = sessions as unknown as SessionListLike
  const archived = workspaces.archivedSessionIds

  const [expandMap, setExpandMap] = useState<Record<string, boolean>>(() => loadExpandState())
  const toggle = (key: string): void => {
    const next = { ...expandMap, [key]: !(expandMap[key] ?? false) }
    setExpandMap(next)
    saveExpandState(next)
  }
  const expandTo = (key: string): void => {
    if (expandMap[key] === true) return
    const next = { ...expandMap, [key]: true }
    setExpandMap(next)
    saveExpandState(next)
  }

  const [viewPrefs, setViewPrefs] = useState(() => loadViewPrefs())
  const setGroupBy = (groupBy: SidebarGroupBy): void => {
    const next = { ...viewPrefs, groupBy }
    setViewPrefs(next)
    saveViewPrefs(next)
  }
  const setOrderBy = (orderBy: SidebarOrderBy): void => {
    const next = { ...viewPrefs, orderBy }
    setViewPrefs(next)
    saveViewPrefs(next)
  }

  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<{
    query: string
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: readonly ContentSearchHit[]
    hasMore: boolean
  }>({ query: '', status: 'idle', items: [], hasMore: false })
  const searchRoot = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const composingRef = useRef(false)
  const [searchOnExpand, setSearchOnExpand] = useState(false)

  useEffect(() => {
    if (props.wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
    return undefined
  }, [props.wide, searchOnExpand])

  useEffect(() => {
    if (!props.wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [props.wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (!props.wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, props.wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({ query: normalizedQuery, status: 'loading', items: [], hasMore: false })
    const timer = window.setTimeout(() => {
      props.searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({ query: normalizedQuery, status: 'ready', items: result.items, hasMore: result.hasMore })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({ query: normalizedQuery, status: 'error', items: [], hasMore: false })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, props.searchSessions])

  const [renameTarget, setRenameTarget] = useState<{ workspaceId: string; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle && items.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === '' || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = (): void => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = (): void => {
    if (renameBlocked || renameTarget === null) return
    setRenaming(true)
    setRenameError(null)
    props.renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: string; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = (): void => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = (): void => {
    if (sessionRenameBlocked || sessionRenameTarget === null) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    props.renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: string, currentTitle: string): void => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }
  const onSessionArchive = (sessionId: string): void => {
    props.archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null || items.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, items])
  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = (): void => {
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    props.deleteWorkspace(deleteTarget.workspaceId).then(() => {
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Worktree removal state. `archivedSet` decides which of the workspace's
  // sessions the flow will archive (everything visible: not archived, not
  // blank, not a subagent row); blank rows hold nothing worth archiving and
  // an Ungrouped blank stays hidden anyway, while subagent rows are never
  // the user's to manage here.
  const [wtRemoveTarget, setWtRemoveTarget] = useState<SidebarMember | null>(null)
  const [wtInspect, setWtInspect] = useState<
    | { status: 'loading' }
    | { status: 'ready'; dirty: number; ahead: number | undefined }
    | { status: 'error'; error: string }
  >({ status: 'loading' })
  const [wtRemoving, setWtRemoving] = useState(false)
  const [wtRemoveError, setWtRemoveError] = useState<string | null>(null)
  useEffect(() => {
    if (wtRemoveTarget === null) return
    setWtInspect({ status: 'loading' })
    let live = true
    void props.inspectWorktree(wtRemoveTarget.workspace.path).then(
      (facts) => { if (live) setWtInspect({ status: 'ready', dirty: facts.dirty, ahead: facts.ahead }) },
      (reason: unknown) => { if (live) setWtInspect({ status: 'error', error: reason instanceof Error ? reason.message : String(reason) }) },
    )
    return () => { live = false }
  }, [wtRemoveTarget])
  const archivedSet = useMemo(() => new Set<string>(archived), [archived])
  const wtArchiveIds = wtRemoveTarget === null ? [] : wtRemoveTarget.workspace.sessionIds.filter((id) => {
    const summary = sessionList.byId[id]
    return summary !== undefined && !archivedSet.has(id) && !summary.blank && summary.origin !== 'subagent'
  })
  const closeWtRemove = (): void => {
    if (wtRemoving) return
    setWtRemoveTarget(null)
    setWtRemoveError(null)
  }
  const confirmWtRemove = (): void => {
    if (wtRemoving || wtRemoveTarget === null || wtInspect.status !== 'ready') return
    const target = wtRemoveTarget
    setWtRemoving(true)
    setWtRemoveError(null)
    // Git first: a refused removal (locked files on Windows, a git error)
    // leaves the workspace world untouched and the dialog retries cleanly.
    // Only after the folder is really gone does the DSH side follow —
    // archive the workspace's sessions (they'd otherwise surface under
    // Ungrouped), then drop the registration itself.
    void (async () => {
      try {
        await props.removeWorktree(target.workspace.path, wtInspect.dirty > 0)
        for (const sessionId of wtArchiveIds) {
          await props.archiveSession(sessionId).catch((reason: unknown) => {
            console.warn('session archive rejected during worktree removal:', reason)
          })
        }
        await props.deleteWorkspace(target.workspace.workspaceId)
        setWtRemoving(false)
        setWtRemoveTarget(null)
      } catch (reason: unknown) {
        setWtRemoving(false)
        setWtRemoveError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
  }

  // Stray (Ungrouped) section: sessions no workspace account holds, clustered
  // by their header cwd into virtual directory groups. Registration is the
  // one action available without any host-side help — workspaces.create is a
  // plain client call; afterwards NEW sessions land in the workspace, while
  // the old strays stay loose (now marked as that workspace's strays) until
  // re-adoption exists.
  // `now` must be declared BEFORE straySection: that JSX evaluates eagerly at
  // render (the .map callbacks run inline), so a forward reference to a later
  // const throws a TDZ ReferenceError and takes the whole sidebar down.
  const now = Date.now()
  const strayGroups = useMemo(() => deriveStrayGroups(items, sessionList, archived), [items, sessionList, archived])
  const strayDescendants = useMemo(() => indexSubagentRunning(sessionList.byId), [sessionList.byId])
  // Directory pre-flight for register-as-workspace: the browser cannot stat,
  // so the host's /exists route answers per unregistered cluster path. Only a
  // probed-true directory offers the action — a missing folder (deleted,
  // moved, or a corrupted session-header cwd) never reaches the DSH workspace
  // API; the row explains itself in hover instead.
  const strayProbePaths = useMemo(
    () => [...new Set(strayGroups.filter(group => group.belongsTo === undefined && group.path !== '').map(group => group.path))],
    [strayGroups],
  )
  const strayProbeSignature = strayProbePaths.join('\n')
  const [strayDirExists, setStrayDirExists] = useState<Readonly<Record<string, boolean>> | undefined>(undefined)
  const [straySlotRebuildable, setStraySlotRebuildable] = useState<Readonly<Record<string, boolean>> | undefined>(undefined)
  useEffect(() => {
    if (strayProbePaths.length === 0) return
    let live = true
    void props.probeDirectories(strayProbePaths).then(
      (result) => {
        if (!live) return
        // A failed probe (undefined) withholds every action: without the
        // host's fs answer the client must not guess.
        setStrayDirExists(result?.exists)
        setStraySlotRebuildable(result?.rebuildable)
      },
      () => { if (live) { setStrayDirExists(undefined); setStraySlotRebuildable(undefined) } },
    )
    return () => { live = false }
  }, [strayProbeSignature])
  const straySectionKey = 'stray:section'
  const strayContainsCurrent = strayGroups.some(group => group.sessions.some(session => session.id === sessions.current))
  const straySectionOpen = expandMap[straySectionKey] ?? strayContainsCurrent
  const strayTotal = strayGroups.reduce((sum, group) => sum + group.sessions.length, 0)
  const [strayRegPath, setStrayRegPath] = useState<string | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const registerStrayWorkspace = (path: string): void => {
    if (strayRegPath !== null) return
    setStrayRegPath(path)
    props.createWorkspace({ path }).then(
      () => { setStrayRegPath(null) },
      (reason: unknown) => {
        setStrayRegPath(null)
        setToast({ seq: Date.now(), text: t('stray.registerFailed', { message: reason instanceof Error ? reason.message : String(reason) }) })
      },
    )
  }
  const [strayRebuildPath, setStrayRebuildPath] = useState<string | null>(null)
  const rebuildStrayDirectory = (path: string): void => {
    if (strayRebuildPath !== null) return
    setStrayRebuildPath(path)
    // mkdir -p on a missing slot is pure self-healing: the workspace keeps its
    // accounting, and DSH's membership projection reattaches the sessions by
    // realpath as soon as the folder answers again.
    void props.ensureDirectory(path).then(
      () => {
        setStrayRebuildPath(null)
        setToast({ seq: Date.now(), text: t('stray.rebuildDone') })
        void props.probeDirectories([path]).then((result) => {
          if (result === undefined) return
          setStrayDirExists(current => ({ ...current, ...result.exists }))
          setStraySlotRebuildable(current => ({ ...current, ...result.rebuildable }))
        })
      },
      (reason: unknown) => {
        setStrayRebuildPath(null)
        setToast({ seq: Date.now(), text: t('stray.rebuildFailed', { message: reason instanceof Error ? reason.message : String(reason) }) })
      },
    )
  }
  const straySection: ReactNode = strayGroups.length === 0 ? undefined : (
    <div className={css.groupSection}>
      <ProjectRowItem
        row={{ key: straySectionKey, label: t('group.ungrouped'), expanded: straySectionOpen, containsCurrent: strayContainsCurrent }}
        onToggle={() => { toggle(straySectionKey) }}
        home={home}
        t={t}
        badge={String(strayTotal)}
      />
      {straySectionOpen && strayGroups.map((group) => {
        const groupOpen = expandMap[group.key] ?? group.sessions.some(session => session.id === sessions.current)
        // Registerable only after the host probed the directory real: absent
        // probe data or an explicit false withholds the action entirely (the
        // DSH create API must never receive an unregistrable path). A missing
        // path that IS a storage slot offers the rebuild instead — pure
        // mkdir self-healing; everything else stays action-free.
        const registrable = group.belongsTo === undefined && group.path !== '' && strayDirExists?.[group.path] === true
        const missingDir = group.belongsTo === undefined && group.path !== '' && strayDirExists?.[group.path] === false
        const rebuildable = missingDir && straySlotRebuildable?.[group.path] === true
        return (
          <div key={group.key} className={cx(css.groupSection, css.memberIndent)}>
            <StrayGroupRow
              path={group.path}
              belongsTo={group.belongsTo}
              count={group.sessions.length}
              expanded={groupOpen}
              onToggle={() => { toggle(group.key) }}
              missingDir={missingDir}
              worktreeSlot={rebuildable}
              {...registrable
                ? { onRegister: () => { registerStrayWorkspace(group.path) }, registering: strayRegPath === group.path }
                : rebuildable
                  ? { onRebuild: () => { rebuildStrayDirectory(group.path) }, rebuilding: strayRebuildPath === group.path }
                  : {}}
              home={home}
              t={t}
            />
            {groupOpen && (
              <div className={css.sessionsIndent}>
                {group.sessions.map(session => (
                  <SessionNodeItem
                    key={session.id}
                    node={sessionNode(session, strayDescendants)}
                    currentId={sessions.current}
                    now={now}
                    onOpen={props.openSession}
                    onRename={onSessionRename}
                    onFork={props.forkSession}
                    onArchive={onSessionArchive}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  const wide = props.wide

  return (
    <div className={cx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={cx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {viewPrefs.groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div className={cx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={cx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={cx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={viewPrefs.groupBy}
              orderBy={viewPrefs.orderBy}
              onGroupPick={setGroupBy}
              onOrderPick={setOrderBy}
              t={t}
            />
          )}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => { setWsPickerOpen(v => !v) }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          pickDirectory={props.pickDirectory}
          createWorkspace={props.createWorkspace}
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            props.startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
          onRetry={() => { setWsPickerOpen(true) }}
        />
      </div>
      {!wide && (
        <div className={css.search}>
          <Tooltip label={t('search')}>
            <button
              type="button"
              className={css.searchButton}
              aria-label={t('search.sessions.aria')}
              onClick={() => {
                setSearchExpanded(true)
                setSearchOnExpand(true)
                props.expandSidebar()
              }}
            >
              <IconSearchOutline16 size={18} />
            </button>
          </Tooltip>
        </div>
      )}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              list={sessionList}
              workspaces={items}
              archivedSessionIds={archived}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={props.searchResultLimit}
              currentId={sessions.current}
              onOpen={props.openSession}
              t={t}
            />
          )
          : viewPrefs.groupBy === 'flat'
            ? (
              <FlatListBody
                list={sessionList}
                archivedSessionIds={archived}
                orderBy={viewPrefs.orderBy}
                currentId={sessions.current}
                now={now}
                onOpen={props.openSession}
                onRename={onSessionRename}
                onFork={props.forkSession}
                onArchive={onSessionArchive}
                t={t}
              />
            )
            : (
              <GroupedTree
                groups={groups}
                footer={straySection}
                sessions={sessionList}
                archived={archived}
                currentSessionId={sessions.current}
                expandMap={expandMap}
                onToggle={toggle}
                expandTo={expandTo}
                orderBy={viewPrefs.orderBy}
                now={now}
                home={home}
                onOpen={props.openSession}
                onRename={onSessionRename}
                onFork={props.forkSession}
                onArchive={onSessionArchive}
                onWorkspaceRename={(workspaceId, currentTitle) => {
                  setRenameTarget({ workspaceId, currentTitle })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                }}
                onWorkspaceDelete={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
                onWorktreeRemove={(member) => {
                  setWtRemoveTarget(member)
                  setWtRemoveError(null)
                }}
                startSession={props.startSession}
                t={t}
              />
            ))}
      </div>
      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => {
            setRenameDraft(e.target.value)
            setRenameError(null)
          }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>
      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => {
            setSessionRenameDraft(e.target.value)
            setSessionRenameError(null)
          }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null ? {} : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button variant="outline" className={css.deleteAction} disabled={deleting} onClick={confirmDelete}>
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
      <Modal
        open={wtRemoveTarget !== null}
        onClose={closeWtRemove}
        closeLabel={t('close')}
        title={t('worktreeRemove.title')}
        {...wtRemoveTarget === null ? {} : { description: t('worktreeRemove.desc', { path: wtRemoveTarget.workspace.path }) }}
        footer={(
          <>
            <Button variant="outline" disabled={wtRemoving} onClick={closeWtRemove}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={wtRemoving || wtInspect.status !== 'ready'}
              onClick={confirmWtRemove}
            >
              {t('worktreeRemove.menu')}
            </Button>
          </>
        )}
      >
        {wtRemoveTarget?.label.type === 'linked' && wtRemoveTarget.label.branch !== null && (
          <div className={css.removeFact}>{t('worktreeRemove.descBranch', { branch: wtRemoveTarget.label.branch })}</div>
        )}
        {wtInspect.status === 'loading' && <div className={css.deleteStatus} role="status">{t('worktreeRemove.inspecting')}</div>}
        {wtInspect.status === 'error' && <div className={css.renameError} role="alert">{wtInspect.error}</div>}
        {wtInspect.status === 'ready' && (
          <div className={css.removeFacts}>
            <div className={cx(css.removeFact, wtInspect.dirty > 0 && css.removeFactWarn)}>
              {wtInspect.dirty > 0
                ? t(wtInspect.dirty === 1 ? 'worktreeRemove.dirty.one' : 'worktreeRemove.dirty.other', { n: wtInspect.dirty })
                : t('worktreeRemove.clean')}
            </div>
            {wtInspect.ahead !== undefined && wtInspect.ahead > 0 && (
              <div className={css.removeFact}>{t('worktreeRemove.ahead', { n: wtInspect.ahead })}</div>
            )}
            {wtArchiveIds.length > 0 && (
              <div className={css.removeFact}>
                {t(wtArchiveIds.length === 1 ? 'worktreeRemove.sessions.one' : 'worktreeRemove.sessions.other', { n: wtArchiveIds.length })}
              </div>
            )}
          </div>
        )}
        {wtRemoving && <div className={css.deleteStatus} role="status">{t('worktreeRemove.busy')}</div>}
        {wtRemoveError !== null && <div className={css.renameError} role="alert">{wtRemoveError}</div>}
      </Modal>
      {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
    </div>
  )
}
