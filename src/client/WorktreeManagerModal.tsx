/**
 * WorktreeManagerModal: the settings card's second-level dialog listing EVERY
 * direct child of the worktree storage root — across repositories, orphan
 * directories included. Each row spells the belonging (repository), the
 * checked-out branch, and the last-use time (the freshest qualifying
 * session's updatedAt, the same activity the lazy prune orders by); the
 * delete button rides the shared removal flow, so a removal here is
 * behaviorally the sidebar's removal: confirm with dirty/ahead facts, git
 * first, archives and unregistration after. Unrecognized directories
 * (probe finds no git repository) render read-only — deleting someone
 * else's folder is outside "worktree management" — and directories with a
 * running session withhold their delete button.
 *
 * @module git-worktree/client/WorktreeManagerModal
 */

import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorktreeScanEntry } from '../wire.ts'
import { timeLabel } from './sidebar-search.ts'
import { mapLimit } from './concurrency.ts'
import { groupScanEntries } from './scan-groups.ts'
import { removeWorktreeFully } from './worktree-remove-flow.ts'
import { freshestUpdatedAt, pathKey } from './worktree-prune.ts'
import css from './WorktreeManagerModal.module.css'

/** Structural minimums of the browser facts the dialog reads; the slot
 * entry injects these from the framework snapshots. */
export interface WorktreeManagerFace {
  /** Scan the storage root; rejects with the host error text. `truncated`
   * marks a root that held more children than the host probes. */
  readonly listWorktrees: () => Promise<{ worktrees: WorktreeScanEntry[]; truncated?: boolean }>
  /** Pre-delete facts of one directory; rejects with the host error text. */
  readonly inspectWorktree: (path: string) => Promise<{ dirty: number; ahead: number | undefined }>
  /** Registered workspaces (path → identity + session membership). */
  readonly workspaces: () => ReadonlyArray<{ workspaceId: string; path: string; sessionIds: readonly string[] }>
  /** Session summary by id (running/blank/origin/updatedAt), when listed. */
  readonly sessionById: (sessionId: string) => { running: boolean; blank: boolean; origin?: 'subagent'; updatedAt: number } | undefined
  /** The registry-global archive set. */
  readonly archivedSessionIds: () => readonly string[]
  /** The shared removal flow's transport actions. */
  readonly removeWorktree: (path: string, force: boolean) => Promise<void>
  /** Directory-existence probe (the Windows half-removal disambiguator). */
  readonly probeDirectories: (paths: readonly string[]) =>
    Promise<{ exists: Readonly<Record<string, boolean>> } | undefined>
  /** Delete a NON-git leftover folder directly (host-gated to the storage
   * root); rejects with the host error text. */
  readonly purgeDirectory: (path: string) => Promise<void>
  readonly archiveSession: (sessionId: string) => Promise<unknown>
  readonly deleteWorkspace: (workspaceId: string) => Promise<unknown>
}

export interface WorktreeManagerModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly face: WorktreeManagerFace
  readonly t: PropsLocale<'git-worktree'>['t']
}

type ScanState =
  | { status: 'loading' }
  | { status: 'ready'; entries: WorktreeScanEntry[]; truncated: boolean }
  | { status: 'error'; error: string }

/** Per-directory pre-delete facts, probed for every valid row up front. */
type InspectMap = Readonly<Record<string, { dirty: number; ahead: number | undefined }>>

/** Concurrent inspects while the dialog loads. One inspect is one git
 * process on the host, so this is the browser-side twin of the /group
 * route's batch cap. */
const INSPECT_CONCURRENCY = 8

/** One removal the confirm dialog is staged for. `git` targets ride the
 * shared removal flow; `orphan` targets (no git identity) are purged
 * directly, then their workspace registration (if one lingers) follows. */
interface RemoveTarget {
  readonly path: string
  readonly branch: string | null
  readonly kind: 'git' | 'orphan'
}

/**
 * The sessions of `workspace.sessionIds` the removal flow will archive:
 * everything visible — not archived, not blank, not a subagent row (the
 * same qualification every removal entry shares).
 */
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

export function WorktreeManagerModal({ open, onClose, face, t }: WorktreeManagerModalProps) {
  const [scan, setScan] = useState<ScanState>({ status: 'loading' })
  const [inspects, setInspects] = useState<InspectMap>({})
  /** Paths known to hold a running session — their delete buttons withhold. */
  const [runningPaths, setRunningPaths] = useState<ReadonlySet<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  /** The "last used" column's reference point. Re-read on every OPEN: this
   * component is mounted for as long as the settings card is expanded (the
   * `open` prop only drives the Modal), so a value frozen at mount would
   * have the dialog quoting hour-old distances. */
  const [now, setNow] = useState(() => Date.now())

  // One scan per open; the derived workspace/session facts come from the
  // same frame's snapshots, so the whole dialog data is coherent.
  useEffect(() => {
    if (!open) return
    let live = true
    setScan({ status: 'loading' })
    setInspects({})
    setRemoveTarget(null)
    setRemoveError(null)
    setNow(Date.now())
    void face.listWorktrees().then(
      async ({ worktrees: entries, truncated }) => {
        if (!live) return
        setScan({ status: 'ready', entries, truncated: truncated === true })
        const valid = entries.filter(entry => entry.repoName !== null)
        const workspaces = face.workspaces()
        const running = new Set<string>()
        for (const workspace of workspaces) {
          for (const sessionId of workspace.sessionIds) {
            if (face.sessionById(sessionId)?.running === true) running.add(pathKey(workspace.path))
          }
        }
        setRunningPaths(running)
        // Bounded fan-out: every inspect is one git process on the host,
        // and a storage root can hold dozens of directories. An unbounded
        // Promise.all here would spawn all of them at once (Windows feels
        // it most) — the /group route caps its own batch for the same
        // reason.
        const facts = await mapLimit(valid, INSPECT_CONCURRENCY, async (entry) => {
          try {
            return [entry.path, await face.inspectWorktree(entry.path)] as const
          } catch {
            return [entry.path, undefined] as const
          }
        })
        if (!live) return
        setInspects(Object.fromEntries(facts.filter(([, value]) => value !== undefined)) as InspectMap)
      },
      (reason: unknown) => {
        if (live) setScan({ status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
      },
    )
    return () => { live = false }
  }, [open, face])

  const closeRemove = (): void => {
    if (removing) return
    setRemoveTarget(null)
    setRemoveError(null)
  }

  const confirmRemove = (): void => {
    if (removing || removeTarget === null) return
    const target = removeTarget
    setRemoving(true)
    setRemoveError(null)
    const workspace = face.workspaces().find(ws => pathKey(ws.path) === pathKey(target.path))
    const work = target.kind === 'orphan'
      ? (async () => {
          await face.purgeDirectory(target.path)
          if (workspace !== undefined) {
            for (const sessionId of archiveIdsFor(face, workspace.sessionIds)) {
              await face.archiveSession(sessionId).catch((reason: unknown) => {
                console.warn('session archive rejected during folder purge:', reason)
              })
            }
            await face.deleteWorkspace(workspace.workspaceId)
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
            ...(workspace === undefined ? {} : { workspaceId: workspace.workspaceId }),
            archiveSessionIds: workspace === undefined ? [] : archiveIdsFor(face, workspace.sessionIds),
          },
        )
    void work.then(
      () => {
        setRemoving(false)
        setRemoveTarget(null)
        // Refresh the list in place: the removed row is gone, facts follow.
        void face.listWorktrees().then(({ worktrees: entries, truncated }) => {
          setScan({ status: 'ready', entries, truncated: truncated === true })
        })
      },
      (reason: unknown) => {
        setRemoving(false)
        setRemoveError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const workspaceIdOf = (path: string): string | undefined =>
    face.workspaces().find(ws => pathKey(ws.path) === pathKey(path))?.workspaceId

  const activityOf = (path: string): number => {
    const workspace = face.workspaces().find(ws => pathKey(ws.path) === pathKey(path))
    if (workspace === undefined) return 0
    // The same helper the lazy prune orders by — the manager's last-use
    // column and the prune's victim order cannot disagree.
    return freshestUpdatedAt(workspace.sessionIds.map(id => face.sessionById(id)))
  }

  const validCount = scan.status === 'ready' ? scan.entries.filter(entry => entry.repoName !== null).length : 0

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
        {scan.status === 'error' && <div className={css.error} role="alert">{t('manager.loadFailed', { message: scan.error })}</div>}
        {scan.status === 'ready' && (
          <div className={css.body}>
            <div className={css.count} role="status">{t('manager.count', { n: validCount })}</div>
            {scan.truncated && <div className={css.warn} role="status">{t('manager.truncated')}</div>}
            {scan.entries.length === 0 && <div className={css.empty}>{t('manager.empty')}</div>}
            <div className={css.list}>
              {groupScanEntries(scan.entries).map(group => (
                <div key={group.repoName ?? '<orphans>'} className={css.group}>
                  <div className={css.groupHead} role="presentation">
                    {group.repoName ?? t('manager.orphans')}
                  </div>
                  {group.entries.map((entry) => {
                    const unknown = entry.repoName === null
                    const activity = unknown ? 0 : activityOf(entry.path)
                    const running = !unknown && runningPaths.has(pathKey(entry.path))
                    const dirty = inspects[entry.path]?.dirty ?? 0
                    return (
                      <div key={entry.path} className={css.row}>
                        <div className={css.rowMain}>
                          <div className={css.rowHead}>
                            <span className={css.rowBranch}>{entry.branch ?? '—'}</span>
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
                          <div className={css.rowPath} title={entry.path}>{entry.path}</div>
                        </div>
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
              const workspace = face.workspaces().find(ws => pathKey(ws.path) === pathKey(removeTarget.path))
              if (workspace === undefined) return null
              const ids = archiveIdsFor(face, workspace.sessionIds)
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
