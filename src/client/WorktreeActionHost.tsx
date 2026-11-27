/**
 * Root `shell.overlay` host for worktree dialogs triggered from native sidebar
 * or header context menus (`manage`, `create`, `remove`).
 *
 * Mounting here decouples modal lifecycles from any single composer `BranchChip`
 * so actions work for background workspaces, archived/inactive sessions, and
 * non-conversation routes alike.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button,
  IconBranchOutlineRegular,
  IconPlusOutlineRegular,
  Modal,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchEntry, DeferredWorktreeSpec, RepoStatus } from '../wire.ts'
import { branchNameIssue } from '../normalize.ts'
import { closeWorktreeAction, getWorktreeAction, subscribeWorktreeAction } from './action-bus.ts'
import { fetchStatus, requestInspectWorktree, requestWorktree, requestWorktreeCutout } from './api.ts'
import { explainGitOpFailure } from './git-error.ts'
import type { AdoptWorktreeOptions } from './slots.ts'
import { emitToast } from './toast-bus.ts'
import { WorktreeManagerModal, type WorktreeManagerFace } from './WorktreeManagerModal.tsx'
import css from './WorktreeActionHost.module.css'

export interface PruneSummaryLike {
  readonly removed: readonly string[]
  readonly skippedDirty: readonly string[]
  readonly failed: readonly unknown[]
}

export interface WorktreeActionHostInjected {
  readonly manager: WorktreeManagerFace
  readonly adoptWorktree: (path: string, options?: AdoptWorktreeOptions) => Promise<void>
  readonly isSwitchSessionDirectory?: (() => boolean) | undefined
  readonly armDeferredWorktree?: ((spec: DeferredWorktreeSpec, options?: AdoptWorktreeOptions) => Promise<void>) | undefined
  readonly describeWorktreeRemoval: (path: string) => { running: boolean; archiveCount: number }
  readonly removeWorktree: (path: string, force: boolean) => Promise<void>
  readonly pruneWorktrees?: ((createdPath: string) => Promise<PruneSummaryLike | undefined>) | undefined
  readonly onWorktreeCreated: (path: string) => void
  readonly onWorktreeRemoved: (path: string) => void
}

function describeWorktreeError(raw: string, fallbackBranch: string, t: PropsLocale<'git-worktree'>['t']): string {
  const failure = explainGitOpFailure(raw)
  if (failure?.kind === 'worktreeOccupied') {
    return t('gitFailWorktreeOccupied', { branch: failure.branch ?? fallbackBranch })
  }
  if (failure?.kind === 'worktreePathExists') {
    return t('gitFailWorktreePathExists')
  }
  return t('errorGeneric', { message: raw })
}

export type WorktreeActionHostProps = WorktreeActionHostInjected & PropsLocale<'git-worktree'>

interface RemoveModalProps {
  readonly path: string
  readonly branch: string | null
  readonly describeWorktreeRemoval: (path: string) => { running: boolean; archiveCount: number }
  readonly removeWorktree: (path: string, force: boolean) => Promise<void>
  readonly onRemoved: (path: string) => void
  readonly onClose: () => void
  readonly t: PropsLocale<'git-worktree'>['t']
}

function RemoveWorktreeModal({
  path,
  branch,
  describeWorktreeRemoval,
  removeWorktree,
  onRemoved,
  onClose,
  t,
}: RemoveModalProps) {
  const [inspect, setInspect] = useState<{ dirty: number; ahead: number | undefined } | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const facts = describeWorktreeRemoval(path)

  useEffect(() => {
    let active = true
    setInspect(null)
    setInspectError(null)
    setRemoveError(null)
    void requestInspectWorktree(path).then((result) => {
      if (!active) return
      if (result.ok) setInspect({ dirty: result.dirty, ahead: result.ahead })
      else setInspectError(result.error)
    })
    return () => { active = false }
  }, [path])

  const handleClose = (): void => {
    if (removing) return
    onClose()
  }

  const handleConfirm = (): void => {
    if (removing || facts.running) return
    setRemoving(true)
    setRemoveError(null)
    const force = (inspect?.dirty ?? 0) > 0
    void removeWorktree(path, force).then(
      () => {
        setRemoving(false)
        onRemoved(path)
        emitToast(t('contextMenu.removeDone'), 'success')
        onClose()
      },
      (reason: unknown) => {
        setRemoving(false)
        setRemoveError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  return (
    <Modal
      open
      onClose={handleClose}
      closeLabel={t('close')}
      title={t('worktreeRemove.title')}
      description={t('worktreeRemove.desc', { path })}
      footer={(
        <>
          <Button variant="outline" disabled={removing} onClick={handleClose}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.removeConfirm}
            disabled={removing || facts.running}
            onClick={handleConfirm}
          >
            {t('worktreeRemove.menu')}
          </Button>
        </>
      )}
    >
      <div className={css.removeFacts}>
        {branch !== null && (
          <div className={css.removeFact}>{t('worktreeRemove.descBranch', { branch })}</div>
        )}
        {facts.running && (
          <div className={`${css.removeFact} ${css.removeFactWarn}`} role="alert">{t('manager.running')}</div>
        )}
        {inspect === null && inspectError === null && (
          <div className={css.status} role="status">{t('worktreeRemove.inspecting')}</div>
        )}
        {inspect !== null && (
          <>
            <div className={inspect.dirty > 0 ? `${css.removeFact} ${css.removeFactWarn}` : css.removeFact}>
              {inspect.dirty > 0
                ? t(inspect.dirty === 1 ? 'worktreeRemove.dirty.one' : 'worktreeRemove.dirty.other', { n: inspect.dirty })
                : t('worktreeRemove.clean')}
            </div>
            {inspect.ahead !== undefined && inspect.ahead > 0 && (
              <div className={css.removeFact}>{t('worktreeRemove.ahead', { n: inspect.ahead })}</div>
            )}
          </>
        )}
        {inspectError !== null && <div className={css.error} role="alert">{inspectError}</div>}
        {facts.archiveCount > 0 && (
          <div className={css.removeFact}>
            {t(facts.archiveCount === 1 ? 'worktreeRemove.sessions.one' : 'worktreeRemove.sessions.other', { n: facts.archiveCount })}
          </div>
        )}
        {removing && <div className={css.status} role="status">{t('worktreeRemove.busy')}</div>}
        {removeError !== null && <div className={css.error} role="alert">{removeError}</div>}
      </div>
    </Modal>
  )
}

type RepoReady = Extract<RepoStatus, { repo: true }>

interface CreateModalProps {
  readonly repoPath: string
  readonly repoName: string
  readonly adoptWorktree: (path: string, options?: AdoptWorktreeOptions) => Promise<void>
  readonly isSwitchSessionDirectory?: (() => boolean) | undefined
  readonly armDeferredWorktree?: ((spec: DeferredWorktreeSpec, options?: AdoptWorktreeOptions) => Promise<void>) | undefined
  readonly pruneWorktrees?: ((createdPath: string) => Promise<PruneSummaryLike | undefined>) | undefined
  readonly onCreated: (path: string) => void
  readonly onClose: () => void
  readonly t: PropsLocale<'git-worktree'>['t']
}

function CreateWorktreeModal({
  repoPath,
  repoName,
  adoptWorktree,
  isSwitchSessionDirectory,
  armDeferredWorktree,
  pruneWorktrees,
  onCreated,
  onClose,
  t,
}: CreateModalProps) {
  const [status, setStatus] = useState<RepoReady | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setStatus(null)
    setLoadError(null)
    setCreateError(null)
    setQuery('')
    void fetchStatus(repoPath).then((result) => {
      if (!active) return
      if (!result.ok) {
        setLoadError(result.error)
        return
      }
      if (!result.repo) {
        setLoadError(t('createModal.loadFailed', { message: 'not a git repository' }))
        return
      }
      setStatus(result)
    })
    return () => { active = false }
  }, [repoPath, t])

  useEffect(() => {
    if (status !== null) inputRef.current?.focus()
  }, [status])

  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()

  const worktreeByBranch = useMemo(() => {
    const map = new Map<string, string>()
    if (status === null) return map
    for (const wt of status.worktrees) {
      if (!wt.main && wt.branch !== null && wt.branch !== undefined) map.set(wt.branch, wt.path)
    }
    return map
  }, [status])

  const filteredBranches = useMemo<readonly BranchEntry[]>(() => {
    if (status === null) return []
    if (lower === '') return status.branches
    return status.branches.filter(entry => entry.name.toLowerCase().includes(lower))
  }, [status, lower])

  const exactBranchExists = status !== null && status.branches.some(entry => entry.name === trimmed)
  const newBranchError = trimmed.length > 0 && !exactBranchExists ? branchNameIssue(trimmed) : undefined
  const canCutNewBranch = status !== null && trimmed.length > 0 && !exactBranchExists && newBranchError === undefined

  const finishWorktree = async (targetPath: string, warnings?: { fetchWarning?: string; excludeWarning?: string; copyWarning?: string }): Promise<void> => {
    onCreated(targetPath)
    await adoptWorktree(targetPath, status === null ? undefined : { repoRoot: status.repoRoot })
    if (warnings?.fetchWarning !== undefined) emitToast(t('fetchWarning', { message: warnings.fetchWarning }))
    if (warnings?.excludeWarning !== undefined) emitToast(t('excludeWarning', { message: warnings.excludeWarning }))
    if (warnings?.copyWarning !== undefined) emitToast(t('copyWarning', { message: warnings.copyWarning }))
    if (pruneWorktrees !== undefined) {
      void pruneWorktrees(targetPath).then((report) => {
        if (report === undefined) return
        if (report.removed.length > 0) emitToast(t('pruneDone', { n: report.removed.length }))
        if (report.failed.length > 0) emitToast(t('pruneFailed', { n: report.failed.length }))
      })
    }
    onClose()
  }

  const armDeferred = (spec: DeferredWorktreeSpec): void => {
    if (armDeferredWorktree === undefined || status === null) return
    void armDeferredWorktree(spec, { repoRoot: status.repoRoot }).then(
      () => {
        setCreating(false)
        onClose()
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const createWithRandomBranch = (): void => {
    if (creating || status === null) return
    setCreating(true)
    setCreateError(null)
    if (isSwitchSessionDirectory?.() === true && armDeferredWorktree !== undefined) {
      armDeferred({ repoPath, branch: status.currentBranch, cutout: true, random: true })
      return
    }
    void requestWorktreeCutout(repoPath, status.currentBranch, undefined, { random: true }).then(
      async (result) => {
        if (!result.ok) {
          setCreating(false)
          setCreateError(describeWorktreeError(result.error, status.currentBranch, t))
          return
        }
        try {
          await finishWorktree(result.path, result)
        } catch (reason: unknown) {
          setCreating(false)
          setCreateError(reason instanceof Error ? reason.message : String(reason))
        }
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const createFromNewBranch = (): void => {
    if (!canCutNewBranch || creating || status === null) return
    setCreating(true)
    setCreateError(null)
    if (isSwitchSessionDirectory?.() === true && armDeferredWorktree !== undefined) {
      armDeferred({ repoPath, branch: status.currentBranch, cutout: true, name: trimmed })
      return
    }
    void requestWorktreeCutout(repoPath, status.currentBranch, trimmed).then(
      async (result) => {
        if (!result.ok) {
          setCreating(false)
          setCreateError(describeWorktreeError(result.error, trimmed, t))
          return
        }
        try {
          await finishWorktree(result.path, result)
        } catch (reason: unknown) {
          setCreating(false)
          setCreateError(reason instanceof Error ? reason.message : String(reason))
        }
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const pickBranch = (entry: BranchEntry): void => {
    if (creating || status === null) return
    setCreating(true)
    setCreateError(null)
    const existingWt = worktreeByBranch.get(entry.name)
    if (existingWt !== undefined) {
      void finishWorktree(existingWt).catch((reason: unknown) => {
        setCreating(false)
        setCreateError(reason instanceof Error ? reason.message : String(reason))
      })
      return
    }
    const isMainOccupied = entry.kind === 'local'
      && status.worktrees.some(wt => wt.main && wt.branch === entry.name)
    if (isSwitchSessionDirectory?.() === true && armDeferredWorktree !== undefined) {
      armDeferred(
        isMainOccupied
          ? { repoPath, branch: entry.name, cutout: true, random: true }
          : { repoPath, branch: entry.name, cutout: false },
      )
      return
    }
    const call = isMainOccupied
      ? requestWorktreeCutout(repoPath, entry.name, undefined, { random: true })
      : requestWorktree(repoPath, entry.name)
    void call.then(
      async (result) => {
        if (!result.ok) {
          setCreating(false)
          setCreateError(describeWorktreeError(result.error, entry.name, t))
          return
        }
        try {
          await finishWorktree(result.path, result)
        } catch (reason: unknown) {
          setCreating(false)
          setCreateError(reason instanceof Error ? reason.message : String(reason))
        }
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const handleClose = (): void => {
    if (creating) return
    onClose()
  }

  return (
    <Modal
      open
      onClose={handleClose}
      closeLabel={t('close')}
      title={t('createModal.title', { repo: repoName })}
      className={css.createDialog ?? ''}
    >
      <div className={css.body}>
        {status === null && loadError === null && (
          <div className={css.status} role="status">{t('createModal.loading')}</div>
        )}
        {loadError !== null && (
          <div className={css.error} role="alert">{t('createModal.loadFailed', { message: loadError })}</div>
        )}
        {status !== null && (
          <>
            <input
              ref={inputRef}
              type="text"
              className={css.searchInput}
              value={query}
              disabled={creating}
              placeholder={t('createModal.searchPlaceholder')}
              onChange={(event) => {
                setQuery(event.target.value)
                setCreateError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (canCutNewBranch) {
                    event.preventDefault()
                    createFromNewBranch()
                  } else if (trimmed === '') {
                    event.preventDefault()
                    createWithRandomBranch()
                  }
                }
              }}
            />
            {newBranchError !== undefined && (
              <div className={css.error} role="status">{t('menuNewBranchBad')}</div>
            )}
            {creating && <div className={css.status} role="status">{t('createModal.creating')}</div>}
            {createError !== null && <div className={css.error} role="alert">{createError}</div>}
            <div className={css.list} role="listbox">
              {trimmed === '' && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={`${css.branchRow} ${css.cutoutRow}`}
                  disabled={creating}
                  onClick={createWithRandomBranch}
                >
                  <span className={css.branchIcon} aria-hidden="true"><IconPlusOutlineRegular size={14} /></span>
                  <span className={css.branchName}>
                    {t('createModal.cutRandomBranch', { base: status.currentBranch })}
                  </span>
                </button>
              )}
              {canCutNewBranch && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={`${css.branchRow} ${css.cutoutRow}`}
                  disabled={creating}
                  onClick={createFromNewBranch}
                >
                  <span className={css.branchIcon} aria-hidden="true"><IconPlusOutlineRegular size={14} /></span>
                  <span className={css.branchName}>
                    {t('createModal.cutNewBranch', { base: status.currentBranch, name: trimmed })}
                  </span>
                </button>
              )}
              {filteredBranches.map((entry) => {
                const hasWorktree = worktreeByBranch.has(entry.name)
                const isCurrent = entry.kind === 'local' && entry.name === status.currentBranch
                return (
                  <button
                    key={`${entry.kind}:${entry.name}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={css.branchRow}
                    disabled={creating}
                    onClick={() => { pickBranch(entry) }}
                  >
                    <span className={css.branchIcon} aria-hidden="true"><IconBranchOutlineRegular size={14} /></span>
                    <span className={css.branchName}>{entry.name}</span>
                    {isCurrent && <Tag tone="neutral">{t('createModal.tagCurrent')}</Tag>}
                    {hasWorktree && <Tag tone="neutral">{t('createModal.tagWorktree')}</Tag>}
                    {entry.kind === 'remote' && <Tag tone="neutral">{t('createModal.tagRemote')}</Tag>}
                  </button>
                )
              })}
              {!canCutNewBranch && filteredBranches.length === 0 && (
                <div className={css.empty}>{t('createModal.noMatches')}</div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** Root overlay component listening to the global worktree action bus. */
export function WorktreeActionHost({
  manager,
  adoptWorktree,
  isSwitchSessionDirectory,
  armDeferredWorktree,
  describeWorktreeRemoval,
  removeWorktree,
  pruneWorktrees,
  onWorktreeCreated,
  onWorktreeRemoved,
  t,
}: WorktreeActionHostProps) {
  const action = useSyncExternalStore(subscribeWorktreeAction, getWorktreeAction, getWorktreeAction)
  if (action === null) return null

  if (action.kind === 'manage') {
    return (
      <WorktreeManagerModal
        open
        face={manager}
        initialRepoFilter={action.repoFilter}
        onClose={closeWorktreeAction}
        t={t}
      />
    )
  }

  if (action.kind === 'remove') {
    return (
      <RemoveWorktreeModal
        path={action.path}
        branch={action.branch}
        describeWorktreeRemoval={describeWorktreeRemoval}
        removeWorktree={removeWorktree}
        onRemoved={onWorktreeRemoved}
        onClose={closeWorktreeAction}
        t={t}
      />
    )
  }

  return (
    <CreateWorktreeModal
      repoPath={action.repoPath}
      repoName={action.repoName}
      adoptWorktree={adoptWorktree}
      isSwitchSessionDirectory={isSwitchSessionDirectory}
      armDeferredWorktree={armDeferredWorktree}
      pruneWorktrees={pruneWorktrees}
      onCreated={onWorktreeCreated}
      onClose={closeWorktreeAction}
      t={t}
    />
  )
}
