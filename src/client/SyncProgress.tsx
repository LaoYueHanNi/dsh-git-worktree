/**
 * SyncProgress: the floating card of a running fetch/update/push — IDEA's
 * background-task popup in this plugin's terms. Title says what is running,
 * the bar follows git's own percentage, the line under it is git's own
 * progress text (stage, counts, transfer speed), and × cancels the transfer.
 *
 * It is a non-modal notice: portalled to the body and fixed to the viewport,
 * so the composer, the menu and the rest of the app stay fully usable while
 * it is up. All the data comes from the {@link SyncJob} the store keeps; this
 * component owns nothing.
 *
 * @module git-worktree/client/SyncProgress
 */

import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncJob } from './sync-job.ts'
import css from './SyncProgress.module.css'

/** Props of the card. */
export interface SyncProgressProps {
  job: SyncJob
  /** The branch the job concerns (the checked-out one), for the title. */
  branch: string
  t: PropsLocale<'git-worktree'>['t']
  /** × pressed: stop the transfer. */
  onCancel: () => void
}

/** What the card shows for one job state. */
export interface SyncView {
  title: string
  /** The line under the bar. */
  detail: string
  /** Bar fill 0–100, or undefined for the sweeping indeterminate bar. */
  percent: number | undefined
  /** Whether × is offered (not once the quick fast-forward has begun). */
  cancellable: boolean
}

/**
 * Decide what the card says for a job, as a pure function of its state.
 * @param job - the job, as the store holds it.
 * @param branch - the checked-out branch.
 * @param t - the plugin's translator.
 */
export function describeSync(job: SyncJob, branch: string, t: SyncProgressProps['t']): SyncView {
  const verb = job.kind === 'update' ? t('syncTitleUpdate', { branch })
    : job.kind === 'push' ? t('syncTitlePush', { branch: job.branch ?? branch })
      : t('syncTitleFetch')
  const title = job.remote === undefined ? verb : `${verb} · ${job.remote}`
  if (job.stage === 'merge') return { title, detail: t('syncMerging', { branch }), percent: undefined, cancellable: false }
  return { title, detail: job.text ?? t('syncConnecting'), percent: job.percent, cancellable: true }
}

/** The floating progress card. */
export function SyncProgress({ job, branch, t, onCancel }: SyncProgressProps) {
  const { title, detail, percent, cancellable } = describeSync(job, branch, t)
  return createPortal(
    <div className={css.card} role="status" aria-live="polite">
      <div className={css.head}>
        <span className={css.title} title={title}>{title}</span>
        {cancellable && (
          <button type="button" className={css.cancel} aria-label={t('syncCancel')} title={t('syncCancel')} onClick={onCancel}>
            <IconCloseOutlineRegular size={12} />
          </button>
        )}
      </div>
      <div className={css.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} {...percent === undefined ? {} : { 'aria-valuenow': percent }}>
        {percent === undefined
          ? <div className={css.indeterminate} />
          : <div className={css.fill} style={{ width: `${percent}%` }} />}
      </div>
      <div className={css.detail} title={detail}>{detail}</div>
    </div>,
    document.body,
  )
}
