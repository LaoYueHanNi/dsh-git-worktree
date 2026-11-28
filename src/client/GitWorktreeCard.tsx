/**
 * The git-worktree bundle configuration view on the Plugins page. The page
 * owns the title, icon, and breadcrumb; this component answers the slot's
 * owner props — `view: 'summary'` renders one descriptive line on the
 * bundle's row, `view: 'page'` renders the configuration form inside the
 * bundle's page. The legacy storage root is READ-ONLY (existing worktrees
 * stay where they are; new ones are created inside their repository), while
 * the keep cap, copy files fallback, and write-through switches remain editable.
 *
 * Renders nothing while the namespace is unavailable: a deployment that did
 * not compose the host half shows no trace of the card.
 *
 * @module git-worktree/client/GitWorktreeCard
 */

import { useEffect, useState } from 'react'
import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** One removed worktree as "repo/branch" — or whichever half the scan knew. */
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
  const [history, setHistory] = useState<readonly PruneRunEntry[]>([])
  const [historyNow, setHistoryNow] = useState(() => Date.now())
  const [historyAll, setHistoryAll] = useState(false)
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
  const lockActions = !state.dirty || state.saving || !state.keepWorktreesValid || !state.postCreateCopyFilesValid
  const legacyRootText = storage?.legacyRoot ?? (state.rootDir === '' ? '—' : state.rootDir)

  return (
    <div className={css.page}>
      {!state.writable ? <p className={css.note} role="status">{t('cardReadOnly')}</p> : null}
      <div className={css.sectionTitle}>{t('cardSectionEntry')}</div>
      <div className={css.field}>
        <span className={css.fieldLabel}>{t('cardRootDirLabel')}</span>
        <span className={css.rootRow}>
          <span className={css.rootValue} title={legacyRootText}>{legacyRootText}</span>
          {state.overridden && (
            <Tag tone="info">{t('cardOverridden').replace(/^[（(]|[）)]$/g, '')}</Tag>
          )}
          {storage !== null && !storage.legacyRootExists && (
            <Tag tone="neutral">{t('cardLegacyUnused')}</Tag>
          )}
        </span>
      </div>
      <p className={css.hint}>{t('cardRootDirHint')}</p>
      <div className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardOpenGraphLabel')}</span>
          <span className={css.toggleHint}>{t('cardOpenGraphHint')}</span>
          {state.switchFailed === 'openGraphByDefault' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <Switch
            label={t('cardOpenGraphLabel')}
            disabled={lockInput}
            checked={state.openGraphByDefault}
            onChange={props.setOpenGraphByDefault}
          />
        </span>
      </div>
      <div className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardHideOfficialWorktreeLabel')}</span>
          <span className={css.toggleHint}>{t('cardHideOfficialWorktreeHint')}</span>
          {state.switchFailed === 'hideOfficialWorktreeEntry' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <Switch
            label={t('cardHideOfficialWorktreeLabel')}
            disabled={lockInput}
            checked={state.hideOfficialWorktreeEntry}
            onChange={props.setHideOfficialWorktreeEntry}
          />
        </span>
      </div>
      <div className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardSwitchSessionDirLabel')}</span>
          <span className={css.toggleHint}>{t('cardSwitchSessionDirHint')}</span>
          {state.switchFailed === 'switchSessionDirectory' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <Switch
            label={t('cardSwitchSessionDirLabel')}
            disabled={lockInput}
            checked={state.switchSessionDirectory}
            onChange={props.setSwitchSessionDirectory}
          />
        </span>
      </div>
      <div className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardManageOfficialWorktreesLabel')}</span>
          <span className={css.toggleHint}>{t('cardManageOfficialWorktreesHint')}</span>
          {state.switchFailed === 'manageOfficialWorktrees' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <Switch
            label={t('cardManageOfficialWorktreesLabel')}
            disabled={lockInput}
            checked={state.manageOfficialWorktrees}
            onChange={props.setManageOfficialWorktrees}
          />
        </span>
      </div>
      <div className={`${css.field} ${css.manageRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardManageWorktrees')}</span>
          <span className={css.toggleHint}>{t('cardManageHint')}</span>
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setManagerOpen(true) }}
        >
          {t('cardManageWorktrees')}
        </Button>
      </div>
      <div className={css.sectionTitle}>{t('cardSectionAutomation')}</div>
      <div className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardFetchBeforeCreateLabel')}</span>
          <span className={css.toggleHint}>{t('cardFetchBeforeCreateHint')}</span>
          {state.switchFailed === 'fetchBeforeCreate' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <Switch
            label={t('cardFetchBeforeCreateLabel')}
            disabled={lockInput}
            checked={state.fetchBeforeCreate}
            onChange={props.setFetchBeforeCreate}
          />
        </span>
      </div>
      <div className={`${css.field} ${css.toggleRow}`}>
        <span className={css.toggleText}>
          <span className={css.toggleLabel}>{t('cardAutoPruneLabel')}</span>
          <span className={css.toggleHint}>{t('cardAutoPruneHint')}</span>
          {state.switchFailed === 'autoPruneWorktrees' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
        </span>
        <span className={css.toggleControl}>
          <Switch
            label={t('cardAutoPruneLabel')}
            disabled={lockInput}
            checked={state.autoPruneWorktrees}
            onChange={props.setAutoPruneWorktrees}
          />
        </span>
      </div>
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
      <label className={`${css.field} ${css.copyFilesRow}`} htmlFor="git-worktree-card-copy-files">
        <span className={css.fieldLabel}>{t('cardPostCreateCopyFilesLabel')}</span>
        <textarea
          id="git-worktree-card-copy-files"
          className={css.copyFilesInput}
          rows={3}
          disabled={lockInput}
          aria-invalid={!state.postCreateCopyFilesValid}
          placeholder={t('cardPostCreateCopyFilesPlaceholder')}
          value={state.postCreateCopyFilesText}
          onChange={event => { props.editPostCreateCopyFiles(event.target.value) }}
        />
        <span className={css.toggleHint}>{t('cardPostCreateCopyFilesHint')}</span>
        {!state.postCreateCopyFilesValid && <span className={css.copyFilesBad} role="alert">{t('cardPostCreateCopyFilesBad')}</span>}
      </label>
      {history.length > 0 && (
        <div className={`${css.field} ${css.historyRow}`}>
          <span className={css.fieldLabel}>{t('cardPruneHistoryLabel')}</span>
          <ul className={css.history}>
            {shownHistory.map(run => (
              <li key={run.at} className={css.historyRun}>
                <span className={css.historyTime}>{timeLabel(run.at, historyNow, t)}</span>
                {run.removed.length > 0
                  ? (
                    <div className={css.historyChips}>
                      <span>{t('cardPruneHistoryRun', { n: run.removed.length })}</span>
                      {run.removed.map((item, idx) => (
                        <span key={`${labelOfRemoved(item)}:${idx}`} className={css.historyChip}>{labelOfRemoved(item)}</span>
                      ))}
                    </div>
                  )
                  : <span className={css.historyLine}>{t('cardPruneHistoryNone')}</span>}
                {run.skippedDirty.length > 0 && (
                  <span className={`${css.historyLine} ${css.historySkipped}`}>{t('cardPruneHistorySkipped', { n: run.skippedDirty.length })}</span>
                )}
                {run.failed.length > 0 && (
                  <span className={`${css.historyLine} ${css.historyFailed}`}>{t('cardPruneHistoryFailed', { n: run.failed.length })}</span>
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
        <Button
          size="sm"
          variant="outline"
          disabled={lockActions}
          onClick={props.discard}
        >
          {t('cardDiscard')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={lockActions}
          onClick={props.save}
        >
          {t(state.saving ? 'cardSaving' : 'cardSave')}
        </Button>
      </div>
    </div>
  )
}
