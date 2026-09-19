/**
 * The git-worktree bundle configuration view on the Plugins page. The page
 * owns the title, icon, and breadcrumb; this component answers the slot's
 * owner props — `view: 'summary'` renders one descriptive line on the
 * bundle's row, `view: 'page'` renders the configuration form inside the
 * bundle's page. The legacy storage root is READ-ONLY (existing worktrees
 * stay where they are; new ones are created inside their repository), while
 * the keep cap and the write-through switches remain editable.
 *
 * Renders nothing while the namespace is unavailable: a deployment that did
 * not compose the host half shows no trace of the card.
 *
 * @module git-worktree/client/GitWorktreeCard
 */

import { useEffect, useState } from 'react'
// Type-only: the plugins-page slot's owner share (`view`), plus the SlotMap
// merge naming 'plugins.bundle.config' itself.
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CardActions, CardStore } from './card-form.ts'
import { readPruneHistory, type PruneRunEntry } from './prune-history.ts'
import { timeLabel } from './relative-time.ts'
import { WorktreeManagerModal, type WorktreeManagerFace } from './WorktreeManagerModal.tsx'
import css from './GitWorktreeCard.module.css'

/** Props the renderer binds for the git-worktree bundle configuration. */
export type GitWorktreeCardProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'git-worktree'>
  & InjectFace<GitWorktreeCardFace>
  & PluginConfigViewProps

/** The registration-side face this slot entry injects. */
export interface GitWorktreeCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useGitWorktreeCard. */
    gitWorktreeCard: CardStore
  }
  /** The worktree manager dialog's face (scan, inspect, shared removal). */
  manager: WorktreeManagerFace
}

/** Prune runs shown before the log folds behind "show all". */
const HISTORY_PREVIEW = 3

/** One removed worktree as "repo/branch" — or whichever half the scan
 * knew. The belonging is a snapshot taken at prune time and either field
 * can be missing; joining them unconditionally printed a bare " /". */
function labelOfRemoved(item: { repoName?: string | null; branch?: string | null }): string {
  const parts = [item.repoName, item.branch].filter((part): part is string => typeof part === 'string' && part !== '')
  return parts.length === 0 ? '?' : parts.join('/')
}

/** The legacy storage location as the page renders it. */
interface StorageFacts {
  legacyRoot: string
  legacyRootExists: boolean
}

/**
 * Render the git-worktree bundle configuration.
 * @param props - locale copy, the card snapshot, its form actions, and the
 * Plugins-page view (`summary` on the bundle row, `page` inside the bundle).
 * @returns the summary line, the page form, or nothing while the namespace
 * is unavailable.
 */
export function GitWorktreeCard(props: GitWorktreeCardProps) {
  const [managerOpen, setManagerOpen] = useState(false)
  /** The prune log and the clock it is measured against, both read ONCE per
   * page mount. Reading localStorage (and Date.now) from the render body
   * made every unrelated re-render re-parse the log and shift the relative
   * times underneath the user. */
  const [history, setHistory] = useState<readonly PruneRunEntry[]>([])
  const [historyNow, setHistoryNow] = useState(() => Date.now())
  /** Whether the log is showing past its preview. Collapses again on every
   * page mount: the log can hold 20 runs, and a settings page is not where
   * a wall of them belongs by default. */
  const [historyAll, setHistoryAll] = useState(false)
  /** The legacy root as the Host resolves it (covers the inherited default
   * the scope snapshot cannot spell), plus whether it exists on disk —
   * "未使用" reads better than hiding the field. */
  const [storage, setStorage] = useState<StorageFacts | null>(null)
  const onPage = props.view === 'page'
  useEffect(() => {
    if (!onPage) return
    setHistory(readPruneHistory())
    setHistoryNow(Date.now())
    setHistoryAll(false)
  }, [onPage])
  useEffect(() => {
    if (!onPage) return
    let live = true
    props.manager.describeStorage().then(
      (facts) => { if (live) setStorage(facts) },
      () => { /* leave the row on the scope's raw value */ },
    )
    return () => { live = false }
  }, [onPage, props.manager])
  const shownHistory = historyAll ? history : history.slice(0, HISTORY_PREVIEW)
  const { t } = props
  const state = props.useGitWorktreeCard(snapshot => snapshot)
  if (!state.available) return null
  if (!onPage) {
    return <p className={css.summary}>{t('cardDescription')}</p>
  }
  const lockInput = !state.writable
  // The keep draft failing validation blocks the save outright: an integer
  // >= 1 is the only shape the Host accepts, so the button disables in
  // lockstep with the inline hint.
  const lockActions = !state.dirty || state.saving || !state.keepWorktreesValid
  const legacyRootText = storage?.legacyRoot ?? (state.rootDir === '' ? '—' : state.rootDir)

  return (
    <div className={css.page}>
      {!state.writable ? <p className={css.note} role="status">{t('cardReadOnly')}</p> : null}
      <div className={css.field}>
        <span className={css.fieldLabel}>{t('cardRootDirLabel')}</span>
        <span className={css.rootRow}>
          <span className={css.rootValue} title={legacyRootText}>{legacyRootText}</span>
          {storage !== null && !storage.legacyRootExists && (
            <span className={css.rootUnused}>{t('cardLegacyUnused')}</span>
          )}
        </span>
      </div>
      <p className={css.hint}>
        {t('cardRootDirHint')}
        {state.overridden ? ` ${t('cardOverridden')}` : ''}
      </p>
      <div className={`${css.field} ${css.manageRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardManageWorktrees')}</span>
          <span className={css.toggleHint}>{t('cardManageHint')}</span>
        </span>
        <button
          type="button"
          className={css.manage}
          onClick={() => { setManagerOpen(true) }}
        >
          {t('cardManageWorktrees')}
        </button>
      </div>
      <label className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardFetchBeforeCreateLabel')}</span>
          <span className={css.toggleHint}>{t('cardFetchBeforeCreateHint')}</span>
          {state.switchFailed === 'fetchBeforeCreate' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <input
            className={css.toggle}
            type="checkbox"
            disabled={lockInput}
            checked={state.fetchBeforeCreate}
            onChange={event => { props.setFetchBeforeCreate(event.target.checked) }}
          />
        </span>
      </label>
      <label className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardAutoPruneLabel')}</span>
          <span className={css.toggleHint}>{t('cardAutoPruneHint')}</span>
          {state.switchFailed === 'autoPruneWorktrees' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <input
            className={css.toggle}
            type="checkbox"
            disabled={lockInput}
            checked={state.autoPruneWorktrees}
            onChange={event => { props.setAutoPruneWorktrees(event.target.checked) }}
          />
        </span>
      </label>
      <label className={`${css.field} ${css.keepRow}`} htmlFor="git-worktree-card-keep">
        <span className={css.fieldLabel}>{t('cardKeepWorktreesLabel')}</span>
        <span className={css.keepControl}>
          <input
            id="git-worktree-card-keep"
            className={css.keepInput}
            type="number"
            min={1}
            step={1}
            disabled={lockInput || !state.autoPruneWorktrees}
            value={state.keepWorktreesText}
            onChange={event => { props.editKeepWorktrees(event.target.value) }}
          />
        </span>
        <span className={css.toggleHint}>{t('cardKeepWorktreesHint')}</span>
        {!state.keepWorktreesValid && <span className={css.keepBad} role="alert">{t('cardKeepWorktreesBad')}</span>}
      </label>
      {/* The auto-prune's audit trail (browser-local, newest first):
        * which run removed whose worktrees, so a misjudged activity
        * is discoverable after the toast has faded. Read once per page
        * mount — a finished prune shows on the next look. Shown whenever
        * there is history, NOT only while the switch is on: having just
        * turned auto-prune off is exactly when a user goes looking for
        * what it did. */}
      {history.length > 0 && (
        <div className={`${css.field} ${css.historyRow}`}>
          <span className={css.fieldLabel}>{t('cardPruneHistoryLabel')}</span>
          <ul className={css.history}>
            {shownHistory.map(run => (
              <li key={run.at} className={css.historyRun}>
                <span className={css.historyTime}>{timeLabel(run.at, historyNow, t)}</span>
                {run.removed.length > 0
                  ? (
                    <span className={css.historyLine}>
                      {t('cardPruneHistoryRun', { n: run.removed.length })}
                      {run.removed.map(item => ` ${labelOfRemoved(item)}`).join(' ·')}
                    </span>
                  )
                  : <span className={css.historyLine}>{t('cardPruneHistoryNone')}</span>}
                {run.skippedDirty.length > 0 && (
                  <span className={css.historyLine}>{t('cardPruneHistorySkipped', { n: run.skippedDirty.length })}</span>
                )}
                {run.failed.length > 0 && (
                  <span className={css.historyLine}>{t('cardPruneHistoryFailed', { n: run.failed.length })}</span>
                )}
              </li>
            ))}
            {history.length > HISTORY_PREVIEW && (
              <li>
                <button type="button" className={css.historyMore} onClick={() => { setHistoryAll(value => !value) }}>
                  {historyAll ? t('cardPruneHistoryLess') : t('cardPruneHistoryMore', { n: history.length })}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {history.length === 0 && state.autoPruneWorktrees && (
        <div className={`${css.field} ${css.historyRow}`}>
          <span className={css.fieldLabel}>{t('cardPruneHistoryLabel')}</span>
          <span className={css.toggleHint}>{t('cardPruneHistoryEmpty')}</span>
        </div>
      )}
      <WorktreeManagerModal
        open={managerOpen}
        onClose={() => { setManagerOpen(false) }}
        face={props.manager}
        t={t}
      />
      <div className={css.footer}>
        {state.failed
          ? <p className={css.failed} role="status">{t('cardSaveFailed')}</p>
          : null}
        <button
          type="button"
          className={css.discard}
          disabled={lockActions}
          onClick={props.discard}
        >
          {t('cardDiscard')}
        </button>
        <button
          type="button"
          className={css.save}
          disabled={lockActions}
          onClick={props.save}
        >
          {t(state.saving ? 'cardSaving' : 'cardSave')}
        </button>
      </div>
    </div>
  )
}
