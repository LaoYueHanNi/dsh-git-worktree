/**
 * GroupedSidebar: the `sidebar.workspaces` seat occupant. P1 aggregation
 * (same-repository workspaces clustered from /group facts) plus a 1:1
 * transplant of the native workspace browser's search, menus, status dots,
 * relative time, view options, rail, and dialogs.
 *
 * Drag-reorder and the native `dsh.workspace.view.v5` store are P3. Adding a
 * workspace uses `workspaces.pickDirectory` rather than re-declaring the
 * `sidebar.workspaces.directoryFlow` child hole (native already declared it;
 * a second declarer throws).
 *
 * @module git-worktree/client/GroupedSidebar
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SessionListState, SnapshotStore, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, IconCloseFill14, IconPersonalizationOutline16, IconProjectAddOutline16,
  IconSearchOutline16, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { OwnerOf, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitFacts } from '../wire.ts'
import {
  deriveFlat, deriveSidebarGroups, indexSubagentRunning, loadExpandState, loadViewPrefs,
  orderedVisibleSessionIds, saveExpandState, saveViewPrefs, sessionNode,
  type SessionListLike, type SessionNode, type SidebarGroup, type SidebarGroupBy,
  type SidebarMember, type SidebarOrderBy, type WorkspaceLike,
} from './sidebar-groups.ts'
import {
  COLLAPSED_SESSION_LIMIT, EXPAND_SLIDE_MS, SEARCH_DEBOUNCE_MS, SEARCH_QUERY_MAX_CODE_UNITS,
  deriveSearchResults, sanitizeSearchQuery, type ContentSearchHit,
} from './sidebar-search.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './sidebar-rows.tsx'
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
  readonly workspacesList: Pick<SnapshotStore<WorkspaceListState>, 'getSnapshot' | 'subscribe'>
  readonly sessionsList: Pick<SnapshotStore<SessionListState>, 'getSnapshot' | 'subscribe'>
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
  readonly createWorkspace: (input: { path: string }) => Promise<{ workspaceId: string }>
  readonly pickDirectory: () => Promise<string | null>
  readonly hostDescription: SidebarObservable<{ home?: string } | undefined>
  readonly directoryFlow: SidebarObservable<boolean>
  /**
   * First facts attempt of this mount has settled (ok or fail). The settings
   * card spinner waits on this so it does not hide while the tree still
   * looks like the native flat list.
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

function GroupedTree({ groups, sessions, archived, currentSessionId, expandMap, onToggle, expandTo, orderBy, now, home, onOpen, onRename, onFork, onArchive, onWorkspaceRename, onWorkspaceDelete, startSession, t }: {
  groups: readonly SidebarGroup[]
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
                startSession={startSession}
                t={t}
              />
            </div>
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

function MemberBlock({ member, indent, sessionIds, sessions, currentSessionId, expandMap, onToggle, expandTo, descendants, expandedSessionGroups, setExpandedSessionGroups, now, home, onOpen, onRename, onFork, onArchive, onWorkspaceRename, onWorkspaceDelete, startSession, t }: {
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
  const host = useSyncExternalStore(props.hostDescription.subscribe, props.hostDescription.getSnapshot)
  const directoryFlowAvailable = useSyncExternalStore(props.directoryFlow.subscribe, props.directoryFlow.getSnapshot)
  const items = workspaces.items as readonly WorkspaceLike[]
  const home = host?.home

  const signature = useMemo(() => [...items].map(item => item.path).sort().join('\n'), [items])
  const [factsState, setFactsState] = useState<FactsState>(null)
  const readyOnce = useRef(false)
  const signalReady = (): void => {
    if (readyOnce.current) return
    readyOnce.current = true
    props.onReady?.()
  }
  useEffect(() => {
    if (factsState?.signature === signature) {
      signalReady()
      return
    }
    let live = true
    void props.loadFacts(items.map(item => item.path)).then(
      (facts) => {
        if (!live) return
        if (facts !== undefined) setFactsState({ signature, facts })
        signalReady()
      },
      () => { if (live) signalReady() },
    )
    return () => { live = false }
  }, [signature, factsState?.signature, props.loadFacts, items])

  const facts = factsState?.signature === signature ? factsState.facts : undefined
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

  const now = Date.now()
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
    </div>
  )
}
