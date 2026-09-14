/**
 * The git-worktree card on the Plugins configuration tab: a collapsible row
 * whose header names the plugin over a one-line description of what its
 * settings govern, disclosing the storage-root control when open. The card
 * owns everything inside it — chrome, controls, and copy — per the keyed-slot
 * contract; the tab only dispatches it under the `git-worktree` namespace
 * key.
 *
 * Renders nothing while the namespace is unavailable: a deployment that did
 * not compose the host half shows no trace of the card. A stored root edit
 * takes effect live (the Host routes read the section source per request);
 * no data moves — worktrees already created stay where they are, and git
 * itself still lists and reuses them.
 *
 * @module git-worktree/client/GitWorktreeCard
 */

import { useEffect, useState } from 'react'
import { IconChevronDownOutline14, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CardActions, CardStore } from './card-form.ts'
import { readPruneHistory, type PruneRunEntry } from './prune-history.ts'
import { timeLabel } from './sidebar-search.ts'
import { WorktreeManagerModal, type WorktreeManagerFace } from './WorktreeManagerModal.tsx'
import css from './GitWorktreeCard.module.css'

/** Props the renderer binds for the git-worktree settings card. */
export type GitWorktreeCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'git-worktree'>
  & InjectFace<GitWorktreeCardFace>

/** The registration-side face this card's slot entry injects. */
export interface GitWorktreeCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useGitWorktreeCard. */
    gitWorktreeCard: CardStore
  }
  /**
   * The shell's native directory picker (the workspace flows' chooser):
   * resolves the chosen absolute path, or null when the user dismisses the
   * dialog.
   */
  pickDirectory: () => Promise<string | null>
  /** The worktree manager dialog's face (scan, inspect, shared removal). */
  manager: WorktreeManagerFace
}

/**
 * Render the git-worktree settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function GitWorktreeCard(props: GitWorktreeCardProps) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  /** The prune log and the clock it is measured against, both read ONCE per
   * card expansion. Reading localStorage (and Date.now) from the render body
   * made every unrelated re-render re-parse the log and shift the relative
   * times underneath the user. */
  const [history, setHistory] = useState<readonly PruneRunEntry[]>([])
  const [historyNow, setHistoryNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    setHistory(readPruneHistory())
    setHistoryNow(Date.now())
  }, [open])
  const { t } = props
  const state = props.useGitWorktreeCard(snapshot => snapshot)
  if (!state.available) return null
  const lockInput = !state.writable
  // The keep draft failing validation blocks the save outright: an integer
  // >= 1 is the only shape the Host accepts, so the button disables in
  // lockstep with the inline hint.
  const lockActions = !state.dirty || state.saving || !state.keepWorktreesValid

  /**
   * Open the shell's native folder dialog and stage the chosen path — the
   * same picker the workspace flows use, driven through the injected
   * workspace service. A dismissal leaves the staged draft exactly as it
   * was; the text input stays the fallback either way.
   */
  const browse = async (): Promise<void> => {
    if (picking || lockInput) return
    setPicking(true)
    try {
      const picked = await props.pickDirectory()
      if (picked !== null && picked !== '') props.editRoot(picked)
    } catch (_pickFailure) {
      // Leave the draft untouched; typing the path remains available.
    } finally {
      setPicking(false)
    }
  }

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'cardCollapse' : 'cardExpand')}: ${t('cardTitle')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('cardTitle')}</span>
          <span className={css.description}>{t('cardDescription')}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{t('cardUnsaved')}</span> : null}
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {!state.writable ? <p className={css.note} role="status">{t('cardReadOnly')}</p> : null}
            <label className={css.field} htmlFor="git-worktree-card-root-dir">
              <span className={css.fieldLabel}>{t('cardRootDirLabel')}</span>
              <span className={css.inputRow}>
                <input
                  id="git-worktree-card-root-dir"
                  className={css.input}
                  type="text"
                  spellCheck={false}
                  value={state.rootDir}
                  disabled={lockInput}
                  onChange={event => { props.editRoot(event.target.value) }}
                />
                <button
                  type="button"
                  className={css.browse}
                  disabled={lockInput || picking}
                  onClick={() => { void browse() }}
                >
                  {t(picking ? 'cardPicking' : 'cardBrowse')}
                </button>
              </span>
            </label>
            <p className={css.hint}>
              {t('cardRootDirHint')}
              {state.overridden ? ` ${t('cardOverridden')}` : ''}
            </p>
            <label className={`${css.field} ${css.toggleRow}`} aria-busy={state.groupingPending}>
              <span className={css.toggleText}>
                <span className={css.toggleLabel}>
                  {t('cardGroupSidebarLabel')}
                  <span className={css.toggleMark}>{t('cardGroupSidebarMark')}</span>
                </span>
                <span className={css.toggleHint}>{t('cardGroupSidebarHint')}</span>
                <span className={css.toggleNote}>{t('cardGroupSidebarNote')}</span>
                {state.switchFailed === 'groupSidebar' && <span className={css.switchBad} role="alert">{t('cardSwitchFailed')}</span>}
              </span>
              <span className={css.toggleControl}>
                {state.groupingPending
                  ? (
                    <span className={css.spinner} role="status" aria-label={t('cardGroupSidebarBusy')}>
                      <IconLoadingOutline16 size={14} />
                    </span>
                  )
                  : null}
                <input
                  className={css.toggle}
                  type="checkbox"
                  disabled={lockInput || state.groupingPending}
                  checked={state.groupSidebar}
                  onChange={event => { props.setGroupSidebar(event.target.checked) }}
                />
              </span>
            </label>
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
              * is discoverable after the toast has faded. Read once per
              * expansion — a finished prune shows on the next look. */}
            {state.autoPruneWorktrees && (
              <div className={`${css.field} ${css.historyRow}`}>
                <span className={css.fieldLabel}>{t('cardPruneHistoryLabel')}</span>
                {history.length === 0
                  ? <span className={css.toggleHint}>{t('cardPruneHistoryEmpty')}</span>
                  : (
                    <ul className={css.history}>
                      {history.map(run => (
                        <li key={run.at} className={css.historyRun}>
                          <span className={css.historyTime}>{timeLabel(run.at, historyNow, t)}</span>
                          {run.removed.length > 0
                            ? (
                              <span className={css.historyLine}>
                                {t('cardPruneHistoryRun', { n: run.removed.length })}
                                {run.removed.map(item => ` ${item.repoName}/${item.branch}`).join(' ·')}
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
                    </ul>
                  )}
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
        : null}
    </li>
  )
}
