/**
 * Shared confirmation modal for removing a linked git worktree or purging an
 * orphaned folder from disk, used by both WorktreeActionHost and WorktreeManagerModal.
 */

import { Button, IconBranchOutlineRegular, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RemoveConfirmModal.module.css'

type Translate = PropsLocale<'git-worktree'>['t']

export interface RemoveConfirmInspectFacts {
  readonly dirty: number
  readonly ahead: number | undefined
}

export interface RemoveConfirmModalProps {
  readonly open: boolean
  readonly kind: 'git' | 'orphan'
  readonly path: string
  readonly branch: string | null
  readonly running?: boolean
  readonly inspect?: RemoveConfirmInspectFacts | null | undefined
  readonly inspectError?: string | null | undefined
  readonly archiveCount: number
  readonly removing: boolean
  readonly removeError: string | null
  readonly onConfirm: () => void
  readonly onClose: () => void
  readonly t: Translate
}

/** Structured remove/purge confirmation dialog separating path identity from risk indicators. */
export function RemoveConfirmModal({
  open,
  kind,
  path,
  branch,
  running = false,
  inspect,
  inspectError = null,
  archiveCount,
  removing,
  removeError,
  onConfirm,
  onClose,
  t,
}: RemoveConfirmModalProps) {
  const isOrphan = kind === 'orphan'
  const title = t(isOrphan ? 'worktreePurge.title' : 'worktreeRemove.title')
  const description = t(isOrphan ? 'worktreePurge.desc' : 'worktreeRemove.desc')
  const confirmLabel = removing
    ? t(isOrphan ? 'worktreePurge.busy' : 'worktreeRemove.busy')
    : t(isOrphan ? 'manager.purgeMenu' : 'worktreeRemove.menu')

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={title}
      description={description}
      className={css.dialog ?? ''}
      footer={(
        <>
          <Button variant="outline" disabled={removing} onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.dangerButton}
            disabled={removing || running}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className={css.body}>
        <div className={css.targetCard}>
          {!isOrphan && branch !== null && (
            <div className={css.branchRow}>
              <span className={css.branchIcon}><IconBranchOutlineRegular size={14} /></span>
              <span className={css.branchName} title={branch}>{branch}</span>
              <Tag tone="neutral">{t('worktreeRemove.branchKeptBadge')}</Tag>
            </div>
          )}
          <div className={css.targetPath} title={path}>{path}</div>
        </div>

        <div className={css.facts}>
          {!isOrphan && running && (
            <div className={css.warnBanner} role="alert">
              <span className={css.dotWarn} aria-hidden="true" />
              <span>{t('manager.running')}</span>
            </div>
          )}

          {!isOrphan && inspect === undefined && inspectError === null && (
            <div className={css.status} role="status">{t('worktreeRemove.inspecting')}</div>
          )}

          {!isOrphan && inspect !== undefined && inspect !== null && (
            <>
              {inspect.dirty > 0 ? (
                <div className={css.warnBanner} role="alert">
                  <span className={css.dotWarn} aria-hidden="true" />
                  <span>{t(inspect.dirty === 1 ? 'worktreeRemove.dirty.one' : 'worktreeRemove.dirty.other', { n: inspect.dirty })}</span>
                </div>
              ) : (
                <div className={css.factRow}>
                  <span className={css.dotSafe} aria-hidden="true" />
                  <span>{t('worktreeRemove.clean')}</span>
                </div>
              )}

              {inspect.ahead !== undefined && inspect.ahead > 0 && (
                <div className={css.factRow}>
                  <span className={css.dotNeutral} aria-hidden="true" />
                  <span>{t('worktreeRemove.ahead', { n: inspect.ahead })}</span>
                </div>
              )}
            </>
          )}

          {!isOrphan && inspectError !== null && (
            <div className={css.error} role="alert">{inspectError}</div>
          )}

          {archiveCount > 0 && (
            <div className={css.factRow}>
              <span className={css.dotNeutral} aria-hidden="true" />
              <span>{t(archiveCount === 1 ? 'worktreeRemove.sessions.one' : 'worktreeRemove.sessions.other', { n: archiveCount })}</span>
            </div>
          )}

          {removeError !== null && (
            <div className={css.error} role="alert">{removeError}</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
