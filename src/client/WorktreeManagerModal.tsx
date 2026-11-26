/**
 * WorktreeManagerModal: the settings card's second-level dialog listing EVERY
 * direct child of the worktree storage root — across repositories, orphan
 * directories included.
 *
 * @module git-worktree/client/WorktreeManagerModal
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCopyOutlineRegular,
  IconFolderCloseRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  Modal,
  PathLabel,
  Tag,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorktreeScanEntry } from '../wire.ts'
import { timeLabel } from './relative-time.ts'
import { mapLimit } from './concurrency.ts'
import { filterScanEntriesByRepo, groupScanEntries, type RepoScopeFilter } from './scan-groups.ts'
import { emitToast } from './toast-bus.ts'
import { removeWorktreeFully } from './worktree-remove-flow.ts'
import { freshestUpdatedAt, pathKey } from './worktree-prune.ts'
import css from './WorktreeManagerModal.module.css'

/** Structural minimums of the browser facts the dialog reads; the slot
 * entry injects these from the framework snapshots. */
export interface WorktreeManagerFace {
  readonly listWorktrees: () => Promise<{
    worktrees: WorktreeScanEntry[]
    legacyRoot: string
    legacyRootExists: boolean
    truncated?: boolean
  }>
  readonly describeStorage: () => Promise<{ legacyRoot: string; legacyRootExists: boolean }>
  readonly inspectWorktree: (path: string) => Promise<{ dirty: number; ahead: number | undefined }>
  readonly workspaces: () => ReadonlyArray<{ workspaceId: string; path: string; sessionIds: readonly string[] }>
  readonly sessionById: (sessionId: string) => { running: boolean; blank: boolean; origin?: 'subagent'; updatedAt: number } | undefined
  readonly archivedSessionIds: () => readonly string[]
  readonly removeWorktree: (path: string, force: boolean) => Promise<void>
  readonly probeDirectories: (paths: readonly string[]) =>
    Promise<{ exists: Readonly<Record<string, boolean>> } | undefined>
  readonly purgeDirectory: (path: string) => Promise<void>
  readonly archiveSession: (sessionId: string) => Promise<unknown>
  readonly deleteWorkspace: (workspaceId: string) => Promise<unknown>
  /**
   * Optional dual-mode ownership resolver (standalone workspace + shared
   * session-directory mode). When provided, running checks, activity timestamps,
   * archive sets, and workspace deletion all ride this unified resolver.
   */
  readonly describeWorktreeOwnership?: (path: string) => {
    readonly running: boolean
    readonly workspaceId?: string | undefined
    readonly archiveIds: readonly string[]
    readonly activity: number
    readonly mode?: 'standalone' | 'session' | 'none' | undefined
  }
  /** Register the directory as a workspace (or switch session cwd in shared mode) and open a session in it. */
  readonly openWorktree?: (path: string, repoRoot?: string) => Promise<void>
  /** Optional notification after a worktree or orphan folder is removed. */
  readonly onWorktreeRemoved?: (path: string) => void
}

export interface WorktreeManagerModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly face: WorktreeManagerFace
  readonly t: PropsLocale<'git-worktree'>['t']
  /** When opened from a workspace context menu, default to showing only this repository's worktrees. */
  readonly initialRepoFilter?: RepoScopeFilter | undefined
}

type ScanState =
  | { status: 'loading' }
  | { status: 'ready'; entries: WorktreeScanEntry[]; truncated: boolean }
  | { status: 'error'; error: string }

/** Per-directory pre-delete facts, probed for every valid row up front. */
type InspectMap = Readonly<Record<string, { dirty: number; ahead: number | undefined }>>

/** Concurrent inspects while the dialog loads. */
const INSPECT_CONCURRENCY = 8

interface RemoveTarget {
  readonly path: string
  readonly branch: string | null
  readonly kind: 'git' | 'orphan'
}

/** The sessions of `workspace.sessionIds` the removal flow will archive. */
function archiveIdsFor(face: WorktreeManagerFace, sessionIds: readonly string[]): string[] {
  const archived = new Set(face.archivedSessionIds())
  const ids: string[] = []
  for (const sessionId of sessionIds) {
    const summary = face.sessionById(sessionId)
    if (summary === undefined) continue
    if (summary.blank || summary.origin === 'subagent') continue
    if (!archived.has(sessionId)) ids.push(sessionId)
  }
  return ids
}

export function WorktreeManagerModal({ open, onClose, face, t, initialRepoFilter }: WorktreeManagerModalProps) {
  const [scan, setScan] = useState<ScanState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [inspects, setInspects] = useState<InspectMap>({})
  const [runningPaths, setRunningPaths] = useState<ReadonlySet<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [scopedToRepo, setScopedToRepo] = useState<boolean>(initialRepoFilter !== undefined)
  const [now, setNow] = useState(() => Date.now())
  const scanGenRef = useRef(0)

  const workspaceAt = useMemo(() => {
    const byPath = new Map(face.workspaces().map(ws => [pathKey(ws.path), ws] as const))
    return (path: string) => byPath.get(pathKey(path))
  }, [face, scan, now])

  const loadWorktrees = useCallback((showLoadingState: boolean): void => {
    const gen = ++scanGenRef.current
    setNow(Date.now())
    if (showLoadingState) {
      setScan({ status: 'loading' })
      setInspects({})
    }
    setRefreshing(true)
    void face.listWorktrees().then(
      async ({ worktrees: entries, truncated }) => {
        if (scanGenRef.current !== gen) return
        setScan({ status: 'ready', entries, truncated: truncated === true })
        const valid = entries.filter(entry => entry.repoName !== null)
        const running = new Set<string>()
        if (face.describeWorktreeOwnership !== undefined) {
          for (const entry of entries) {
            if (face.describeWorktreeOwnership(entry.path).running) running.add(pathKey(entry.path))
          }
        } else {
          const workspaces = face.workspaces()
          for (const workspace of workspaces) {
            for (const sessionId of workspace.sessionIds) {
              if (face.sessionById(sessionId)?.running === true) running.add(pathKey(workspace.path))
            }
          }
        }
        setRunningPaths(running)
        const facts = await mapLimit(valid, INSPECT_CONCURRENCY, async (entry) => {
          try {
            return [entry.path, await face.inspectWorktree(entry.path)] as const
          } catch {
            return [entry.path, undefined] as const
          }
        })
        if (scanGenRef.current !== gen) return
        setInspects(Object.fromEntries(facts.filter(([, value]) => value !== undefined)) as InspectMap)
        setRefreshing(false)
      },
      (reason: unknown) => {
        if (scanGenRef.current !== gen) return
        setRefreshing(false)
        setScan({ status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
      },
    )
  }, [face])

  useEffect(() => {
    if (!open) {
      scanGenRef.current += 1
      return
    }
    setRemoveTarget(null)
    setRemoveError(null)
    setOpeningPath(null)
    setScopedToRepo(initialRepoFilter !== undefined)
    loadWorktrees(true)
    return () => { scanGenRef.current += 1 }
  }, [open, loadWorktrees, initialRepoFilter?.repoRoot])

  const closeRemove = (): void => {
    if (removing) return
    setRemoveTarget(null)
    setRemoveError(null)
  }

  const handleOpenWorktree = (path: string, repoRoot?: string): void => {
    if (face.openWorktree === undefined || openingPath !== null) return
    setOpeningPath(path)
    void face.openWorktree(path, repoRoot).then(
      () => {
        setOpeningPath(null)
        onClose()
      },
      (reason: unknown) => {
        setOpeningPath(null)
        const message = reason instanceof Error ? reason.message : String(reason)
        emitToast(t('manager.openFailed', { message }))
      },
    )
  }

  const handleCopyPath = (path: string): void => {
    void writeClipboard(path).then((ok) => {
      if (ok) emitToast(t('hover.copied'), 'success')
    })
  }

  const confirmRemove = (): void => {
    if (removing || removeTarget === null) return
    const target = removeTarget
    setRemoving(true)
    setRemoveError(null)
    const ownership = face.describeWorktreeOwnership?.(target.path)
    const workspace = workspaceAt(target.path)
    const targetWorkspaceId = ownership !== undefined ? ownership.workspaceId : workspace?.workspaceId
    const targetArchiveIds = ownership !== undefined
      ? [...ownership.archiveIds]
      : (workspace === undefined ? [] : archiveIdsFor(face, workspace.sessionIds))
    const work = target.kind === 'orphan'
      ? (async () => {
          await face.purgeDirectory(target.path)
          for (const sessionId of targetArchiveIds) {
            await face.archiveSession(sessionId).catch((reason: unknown) => {
              console.warn('session archive rejected during folder purge:', reason)
            })
          }
          if (targetWorkspaceId !== undefined) {
            await face.deleteWorkspace(targetWorkspaceId)
          }
        })()
      : removeWorktreeFully(
          {
            removeWorktree: face.removeWorktree,
            probeDirectories: face.probeDirectories,
            archiveSession: face.archiveSession,
            deleteWorkspace: face.deleteWorkspace,
          },
          {
            path: target.path,
            force: (inspects[target.path]?.dirty ?? 0) > 0,
            ...(targetWorkspaceId === undefined ? {} : { workspaceId: targetWorkspaceId }),
            archiveSessionIds: targetArchiveIds,
          },
        )
    void work.then(
      () => {
        setRemoving(false)
        setRemoveTarget(null)
        face.onWorktreeRemoved?.(target.path)
        // Re-scan entries, inspect facts, and running paths together so no stale state lingers.
        loadWorktrees(false)
      },
      (reason: unknown) => {
        setRemoving(false)
        setRemoveError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const activityOf = (path: string): number => {
    if (face.describeWorktreeOwnership !== undefined) {
      return face.describeWorktreeOwnership(path).activity
    }
    const workspace = workspaceAt(path)
    if (workspace === undefined) return 0
    return freshestUpdatedAt(workspace.sessionIds.map(id => face.sessionById(id)))
  }

  const activeScope = scopedToRepo ? initialRepoFilter : undefined
  const visibleEntries = scan.status === 'ready'
    ? (activeScope === undefined ? scan.entries : filterScanEntriesByRepo(scan.entries, activeScope))
    : []
  const validCount = visibleEntries.filter(entry => entry.repoName !== null).length
  const orphanCount = visibleEntries.length - validCount
  const totalCount = scan.status === 'ready' ? scan.entries.length : 0

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        closeLabel={t('close')}
        title={t('manager.title')}
        className={css.dialog ?? ''}
      >
        {scan.status === 'loading' && <div className={css.status} role="status">{t('manager.loading')}</div>}
        {scan.status === 'error' && (
          <div className={css.body}>
            <div className={css.error} role="alert">{t('manager.loadFailed', { message: scan.error })}</div>
            <div className={css.toolbar}>
              <Button size="sm" variant="outline" disabled={refreshing} onClick={() => { loadWorktrees(true) }}>
                {t('manager.refresh')}
              </Button>
            </div>
          </div>
        )}
        {scan.status === 'ready' && (
          <div className={css.body}>
            {initialRepoFilter !== undefined && (
              <div className={css.scopeBar}>
                <span className={css.scopeInfo}>
                  {activeScope !== undefined ? (
                    <>
                      <span>{t('manager.scopeRepo')}</span>
                      <span className={css.scopeName}>{initialRepoFilter.repoName}</span>
                    </>
                  ) : (
                    <span>{t('manager.showAllRepos')}</span>
                  )}
                </span>
                <button
                  type="button"
                  className={css.scopeToggle}
                  onClick={() => { setScopedToRepo(prev => !prev) }}
                >
                  {activeScope !== undefined
                    ? t('manager.showAllRepos')
                    : t('manager.scopeBack', { repo: initialRepoFilter.repoName })}
                </button>
              </div>
            )}
            <div className={css.toolbar}>
              <div className={css.count} role="status">
                {t('manager.count', { n: validCount })}
                {orphanCount > 0 && t('manager.countOrphans', { n: orphanCount })}
              </div>
              <button
                type="button"
                className={css.refresh}
                disabled={refreshing}
                title={t('manager.refresh')}
                aria-label={t('manager.refresh')}
                onClick={() => { loadWorktrees(false) }}
              >
                <IconRefreshOutlineRegular size={13} />
                <span>{t('manager.refresh')}</span>
              </button>
            </div>
            {scan.truncated && <div className={css.warn} role="status">{t('manager.truncated')}</div>}
            {visibleEntries.length === 0 && (
              <div className={css.empty}>
                {activeScope !== undefined ? (
                  <>
                    <span>{t('manager.emptyScoped', { repo: activeScope.repoName })}</span>
                    {totalCount > 0 && (
                      <button
                        type="button"
                        className={`${css.scopeToggle} ${css.emptyAction}`}
                        onClick={() => { setScopedToRepo(false) }}
                      >
                        {t('manager.showAllRepos')}
                      </button>
                    )}
                  </>
                ) : t('manager.empty')}
              </div>
            )}
            <div className={css.list}>
              {groupScanEntries(visibleEntries).map(group => (
                <div key={`${group.source}:${group.repoName ?? '<orphans>'}`} className={css.group}>
                  <div className={css.groupHead} role="presentation">
                    <span className={css.groupIcon} aria-hidden="true"><IconFolderCloseRegular size={13} /></span>
                    <span className={css.groupName}>{group.repoName ?? t('manager.orphans')}</span>
                    {group.repoName !== null && (
                      <Tag tone="neutral">
                        {t(
                          group.source === 'legacy'
                            ? 'manager.sourceLegacy'
                            : group.source === 'official'
                              ? 'manager.sourceOfficial'
                              : 'manager.sourceProject',
                        )}
                      </Tag>
                    )}
                    {group.repoName !== null && (
                      <span className={css.groupCount}>{t('manager.count', { n: group.entries.length })}</span>
                    )}
                  </div>
                  {group.entries.map((entry) => {
                    const unknown = entry.repoName === null
                    const ownership = unknown ? undefined : face.describeWorktreeOwnership?.(entry.path)
                    const activity = unknown ? 0 : (ownership !== undefined ? ownership.activity : activityOf(entry.path))
                    const bindingMode = unknown
                      ? 'none'
                      : (ownership?.mode ?? (workspaceAt(entry.path) !== undefined ? 'standalone' : 'none'))
                    const running = !unknown && runningPaths.has(pathKey(entry.path))
                    const dirty = inspects[entry.path]?.dirty ?? 0
                    return (
                      <div key={entry.path} className={css.row}>
                        <div className={css.rowMain}>
                          <div className={css.rowHead}>
                            <span className={css.rowBranch}>{entry.branch ?? '—'}</span>
                            {bindingMode === 'standalone' && (
                              <Tag tone="neutral">{t('manager.modeStandalone')}</Tag>
                            )}
                            {bindingMode === 'session' && (
                              <Tag tone="neutral">{t('manager.modeSession')}</Tag>
                            )}
                            {!unknown && dirty > 0 && (
                              <span className={css.rowDirty} role="status">
                                {t(dirty === 1 ? 'manager.dirty.one' : 'manager.dirty.other', { n: dirty })}
                              </span>
                            )}
                            {!unknown && (
                              <span className={css.rowActivity}>
                                {activity > 0 ? timeLabel(activity, now, t) : t('manager.activityNever')}
                              </span>
                            )}
                          </div>
                          <PathLabel path={entry.path} className={css.rowPath ?? ''} />
                        </div>
                        <div className={css.rowActions}>
                          {!unknown && face.openWorktree !== undefined && (
                            <button
                              type="button"
                              className={css.rowAction}
                              disabled={openingPath !== null}
                              title={t('manager.openSession')}
                              aria-label={t('manager.openSession')}
                              onClick={() => { handleOpenWorktree(entry.path, entry.repoRoot) }}
                            >
                              <IconRightUpOutlineRegular size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className={css.rowAction}
                            title={t('manager.copyPath')}
                            aria-label={t('manager.copyPath')}
                            onClick={() => { handleCopyPath(entry.path) }}
                          >
                            <IconCopyOutlineRegular size={14} />
                          </button>
                          {!unknown ? (
                            <button
                              type="button"
                              className={css.remove}
                              disabled={running}
                              title={running ? t('manager.running') : t('manager.removeAria', { path: entry.path })}
                              aria-label={t('manager.removeAria', { path: entry.path })}
                              onClick={() => {
                                setRemoveTarget({ path: entry.path, branch: entry.branch, kind: 'git' })
                                setRemoveError(null)
                              }}
                            >
                              {t('worktreeRemove.menu')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={css.remove}
                              disabled={running}
                              title={running ? t('manager.running') : t('manager.purgeAria', { path: entry.path })}
                              aria-label={t('manager.purgeAria', { path: entry.path })}
                              onClick={() => {
                                setRemoveTarget({ path: entry.path, branch: null, kind: 'orphan' })
                                setRemoveError(null)
                              }}
                            >
                              {t('manager.purgeMenu')}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={removeTarget !== null}
        onClose={closeRemove}
        closeLabel={t('close')}
        title={removeTarget?.kind === 'orphan' ? t('worktreePurge.title') : t('worktreeRemove.title')}
        {...removeTarget === null ? {} : { description: t(removeTarget.kind === 'orphan' ? 'worktreePurge.desc' : 'worktreeRemove.desc', { path: removeTarget.path }) }}
        footer={(
          <>
            <Button variant="outline" disabled={removing} onClick={closeRemove}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.removeConfirm}
              disabled={removing}
              onClick={confirmRemove}
            >
              {removeTarget?.kind === 'orphan' ? t('manager.purgeMenu') : t('worktreeRemove.menu')}
            </Button>
          </>
        )}
      >
        {removeTarget?.kind === 'git' && removeTarget.branch !== null && (
          <div className={css.removeFact}>{t('worktreeRemove.descBranch', { branch: removeTarget.branch })}</div>
        )}
        {removeTarget?.kind === 'git' && inspects[removeTarget.path] === undefined && <div className={css.status} role="status">{t('worktreeRemove.inspecting')}</div>}
        {removeTarget?.kind === 'git' && inspects[removeTarget.path] !== undefined && (
          <div className={css.removeFacts}>
            <div className={(inspects[removeTarget.path]?.dirty ?? 0) > 0 ? `${css.removeFact} ${css.removeFactWarn}` : css.removeFact}>
              {(inspects[removeTarget.path]?.dirty ?? 0) > 0
                ? t((inspects[removeTarget.path]?.dirty ?? 0) === 1 ? 'worktreeRemove.dirty.one' : 'worktreeRemove.dirty.other', { n: inspects[removeTarget.path]?.dirty ?? 0 })
                : t('worktreeRemove.clean')}
            </div>
            {removeTarget !== null && inspects[removeTarget.path]?.ahead !== undefined && (inspects[removeTarget.path]?.ahead ?? 0) > 0 && (
              <div className={css.removeFact}>{t('worktreeRemove.ahead', { n: inspects[removeTarget.path]?.ahead ?? 0 })}</div>
            )}
            {removeTarget !== null && (() => {
              const ids = face.describeWorktreeOwnership !== undefined
                ? face.describeWorktreeOwnership(removeTarget.path).archiveIds
                : (() => {
                    const workspace = workspaceAt(removeTarget.path)
                    return workspace === undefined ? [] : archiveIdsFor(face, workspace.sessionIds)
                  })()
              if (ids.length === 0) return null
              return <div className={css.removeFact}>{t(ids.length === 1 ? 'worktreeRemove.sessions.one' : 'worktreeRemove.sessions.other', { n: ids.length })}</div>
            })()}
          </div>
        )}
        {removing && <div className={css.status} role="status">{removeTarget?.kind === 'orphan' ? t('worktreePurge.busy') : t('worktreeRemove.busy')}</div>}
        {removeError !== null && <div className={css.error} role="alert">{removeError}</div>}
      </Modal>
    </>
  )
}
