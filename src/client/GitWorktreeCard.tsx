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

import { useState } from 'react'
import { IconChevronDownOutline14, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CardActions, CardStore } from './card-form.ts'
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
}

/**
 * Render the git-worktree settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function GitWorktreeCard(props: GitWorktreeCardProps) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const { t } = props
  const state = props.useGitWorktreeCard(snapshot => snapshot)
  if (!state.available) return null
  const lockInput = !state.writable
  const lockActions = !state.dirty || state.saving

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
