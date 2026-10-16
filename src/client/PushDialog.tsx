import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, IconBranchOutlineRegular, IconCloseOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchEntry, PushBody, PushPlan, PushPreview } from '../wire.ts'
import { branchNameIssue } from '../normalize.ts'
import { requestPushPlan, requestPushPreview } from './api.ts'
import { classifyPushFailure, gitOutput, showsGitOutput, type PushFailureKind } from './push-error.ts'
import type { PushFailure } from './sync-job.ts'
import css from './PushDialog.module.css'

export interface PushDialogProps {
  repoPath: string
  repoName: string
  branch: string
  /** Already displayed by the branch picker; reuse before commit subjects arrive. */
  branchInfo?: BranchEntry
  busy: boolean
  /** A push of this branch that just failed, being shown again: the window
   * comes back with the destination and tag choice it was pushed with, and
   * git's reason already on screen — one click from a retry. */
  resume?: PushFailure
  t: PropsLocale<'git-worktree'>['t']
  onClose: () => void
  /**
   * Hand the push over. Resolves `undefined` once it has been taken (the
   * owner closes this window and the push runs behind its progress card, so
   * a failure comes back as a new window, see `resume`), or with an error to
   * keep the window open and explain it (nothing was started).
   */
  onPush: (options: Pick<PushBody, 'remote' | 'target' | 'tags' | 'force' | 'sourceOid' | 'expectedTarget'>) => Promise<string | undefined>
}

type Destination = { remote: string; target: string }

const FAILURE_KEYS = {
  behind: 'pushFailBehind',
  stale: 'pushFailStale',
  hook: 'pushFailHook',
  refused: 'pushFailRefused',
  auth: 'pushFailAuth',
} as const satisfies Record<PushFailureKind, string>

function Chevron() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" className={css.chevron}><path d="m4 6 4 4 4-4" /></svg>
}

/**
 * The host Modal closes on a click of its mask, the same command as Escape.
 * For a review in progress that is too easy to hit: one stray click beside
 * the window would throw away the destination, the preview and any edit.
 * This swallows only that click, found as the element right before the
 * dialog card; Escape, the close button and Cancel still close. If the host
 * ever changes its markup the mask simply closes the window again.
 * @param event - the click, seen in the capture phase before the host does.
 * @param anchor - any element inside the dialog card.
 * @returns whether the click was on the mask and has been swallowed.
 */
export function swallowMaskClick(event: { target: EventTarget | null; stopPropagation: () => void }, anchor: Element | null): boolean {
  const mask = anchor?.closest('[role="dialog"]')?.previousElementSibling
  if (mask === undefined || mask === null || event.target !== mask) return false
  event.stopPropagation()
  return true
}

/** Compact push review: the branch/target and footer stay outside the scrolling list. */
export function PushDialog({ repoPath, repoName, branch, branchInfo, busy, resume, t, onClose, onPush }: PushDialogProps) {
  const [plan, setPlan] = useState<PushPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [previewState, setPreviewState] = useState<{ destination: typeof destination; data?: PushPreview; error?: string } | null>(null)
  const [localState, setLocalState] = useState<{ destination: typeof destination; data: PushPreview } | null>(null)
  const [retry, setRetry] = useState(0)
  const [planRetry, setPlanRetry] = useState(0)
  const [menu, setMenu] = useState<'remote' | 'tags' | 'push' | null>(null)
  const [editing, setEditing] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const [draft, setDraft] = useState('')
  const [tags, setTags] = useState(resume !== undefined && resume.tags !== 'none')
  const [scope, setScope] = useState<'all' | 'follow'>(resume?.tags === 'follow' ? 'follow' : 'all')
  const [pushError, setPushError] = useState<string | null>(resume?.error ?? null)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  /** The destination of the failed push, applied once, when the first plan
   * arrives; every later plan (a refresh) is the repository's own again. */
  const resumeDestination = useRef(resume === undefined ? undefined : { remote: resume.remote, target: resume.target })
  /** A destination whose local snapshot is already on screen: the next
   * preview round for exactly that destination skips re-reading it. */
  const keepLocalFor = useRef<Destination | null>(null)
  const anchor = useRef<HTMLElement>(null)
  const mapping = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const targetButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    setPlanError(null)
    void requestPushPlan(repoPath, branch).then(result => {
      if (!active) return
      if (!result.ok) { setPlanError(result.error); return }
      const planned = { remote: result.remote, target: result.target }
      const resumed = resumeDestination.current
      resumeDestination.current = undefined
      // A retry window starts where the failed push went, unless that remote
      // has since been removed.
      const next = resumed !== undefined && result.remotes.includes(resumed.remote)
        && (resumed.remote !== planned.remote || resumed.target !== planned.target) ? resumed : planned
      setPlan(result)
      // The plan arrives with a local snapshot of its own default destination.
      if (result.local !== undefined && next === planned) {
        keepLocalFor.current = next
        setLocalState({ destination: next, data: result.local })
      }
      setDestination(next)
    })
    return () => { active = false }
  }, [repoPath, branch, planRetry])

  useEffect(() => {
    if (destination === null) return
    let active = true
    setPreviewState({ destination })
    if (keepLocalFor.current === destination) {
      keepLocalFor.current = null
    } else {
      setLocalState(null)
      // A local snapshot must not wait for SSH or a fetch. It is display-only:
      // submission and the New badge always use the verified remote result.
      void requestPushPreview({ repoPath, branch, ...destination, localOnly: true }).then(result => {
        if (active && result.ok) setLocalState({ destination, data: result })
      })
    }
    void requestPushPreview({ repoPath, branch, ...destination }).then(result => {
      if (!active) return
      setPreviewState(result.ok ? { destination, data: result } : { destination, error: result.error })
    })
    return () => { active = false }
  }, [repoPath, branch, destination, retry])

  useEffect(() => {
    if (!editing) return
    input.current?.focus()
    input.current?.select()
  }, [editing])

  // The editor hangs under the target name; near the dialog's right edge it
  // would spill out, so it then aligns to the name's right edge instead.
  useLayoutEffect(() => {
    if (!editing) { setAlignEnd(false); return }
    const box = editor.current?.getBoundingClientRect()
    const bound = mapping.current?.getBoundingClientRect()
    if (box !== undefined && bound !== undefined) setAlignEnd(box.right > bound.right + 0.5)
  }, [editing])

  useEffect(() => {
    const onClick = (event: MouseEvent) => { swallowMaskClick(event, anchor.current) }
    window.addEventListener('click', onClick, true)
    return () => { window.removeEventListener('click', onClick, true) }
  }, [])

  const current = previewState?.destination === destination ? previewState : null
  const preview = current?.data
  const displayPreview = preview ?? (localState?.destination === destination ? localState.data : undefined)
  // Ahead is relative to the upstream, which may differ from the configured
  // push destination. Reuse it only while planning or for that exact target.
  const reuseAhead = branchInfo?.kind === 'local' && branchInfo.name === branch
    && branchInfo.upstream !== undefined && !branchInfo.upstreamGone
    && (destination === null || branchInfo.upstream === `${destination.remote}/${destination.target}`)
  const knownTotal = reuseAhead ? branchInfo.ahead ?? 0 : undefined
  const checking = destination !== null && preview === undefined && current?.error === undefined && planError === null
  const disabled = busy || sending
  const error = pushError ?? current?.error ?? planError
  const failure = error === null ? null : classifyPushFailure(error)
  const canPush = !disabled && !editing && preview !== undefined && destination !== null
  const nothingToPush = preview !== undefined && preview.targetOid !== null && preview.total === 0 && !tags
  const pushTitle = !canPush && checking ? t('pushCheckingRemote') : nothingToPush ? t('pushEmpty') : undefined
  const draftIssue = branchNameIssue(draft.trim())
  const commits = (n: number) => t(n === 1 ? 'pushCommitCount.one' : 'pushCommitCount.other', { n })
  const close = () => { if (!disabled && !sendingRef.current) onClose() }
  const refresh = () => {
    if (disabled) return
    setPushError(null)
    setPreviewState(null)
    setLocalState(null)
    keepLocalFor.current = null
    if (plan === null) setPlanRetry(value => value + 1)
    else setRetry(value => value + 1)
  }
  /** A new object re-reads the destination from the remote, so an unchanged
   * choice (same remote re-picked, same name re-applied) must not make one. */
  const changeDestination = (next: Destination) => {
    if (destination !== null && destination.remote === next.remote && destination.target === next.target) return
    setPushError(null)
    setDestination(next)
  }
  const applyTarget = () => {
    const target = draft.trim()
    if (destination === null || branchNameIssue(target) !== null) return
    changeDestination({ ...destination, target })
    setEditing(false)
    targetButton.current?.focus()
  }
  const closeEditor = () => {
    setEditing(false)
    targetButton.current?.focus()
  }

  const submit = async (force: boolean) => {
    if (!canPush || sendingRef.current || preview === undefined || destination === null) return
    sendingRef.current = true
    setSending(true)
    setMenu(null)
    setPushError(null)
    try {
      const failed = await onPush({ ...destination, tags: tags ? scope : 'none', force, sourceOid: preview.sourceOid,
        ...(force ? { expectedTarget: preview.targetOid ?? '' } : {}) })
      if (failed !== undefined) {
        setPushError(failed)
        // The preview this push was built from is often exactly what went
        // stale (the remote moved on). Read it again so the retry works from
        // current facts; a credential failure would only fail the same way.
        if (classifyPushFailure(failed) !== 'auth') {
          keepLocalFor.current = destination
          setRetry(value => value + 1)
        }
      }
    } catch (cause) {
      setPushError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return <Modal open headless title={`${t('pushTitle')} · ${repoName}`} onClose={close} className={css.dialog ?? ''}
    onKeyDownCapture={event => {
      if (event.key === 'Escape' && editing) {
        event.preventDefault()
        event.stopPropagation()
        closeEditor()
      }
    }}>
    <header className={css.header} ref={anchor}>
      <h2>{t('pushTitle')} <span>· {repoName}</span></h2>
      <button type="button" className={css.close} aria-label={t('close')} disabled={disabled} onClick={close}><IconCloseOutlineRegular size={14} /></button>
    </header>
    <div className={css.body}>
      <div className={css.mapping} ref={mapping}>
        <IconBranchOutlineRegular size={14} />
        <span className={css.source} title={branch}>{branch}</span><span className={css.arrow}>→</span>
        {destination !== null && <div className={css.destination}>
          {plan !== null && plan.remotes.length > 1 ? <Menu open={menu === 'remote'} dense portal autoFocus
            onClose={() => { setMenu(null) }} selectedId={destination.remote}
            items={plan.remotes.map(remote => ({ id: remote, label: remote }))}
            onSelect={remote => { setMenu(null); changeDestination({ ...destination, remote }) }}
            anchor={<button type="button" className={css.textButton} disabled={disabled || editing} aria-haspopup="menu" aria-expanded={menu === 'remote'}
              onClick={() => { setMenu(menu === 'remote' ? null : 'remote') }}>{destination.remote}<Chevron /></button>} />
            : <span className={css.remote}>{destination.remote}</span>}
          <span className={css.arrow}>:</span>
          <div className={css.targetWrap}>
            <button type="button" ref={targetButton} className={css.textButton} disabled={disabled} title={t('pushEditTarget')}
              aria-haspopup="dialog" aria-expanded={editing} onClick={() => {
                setMenu(null)
                setDraft(destination.target)
                setEditing(value => !value)
              }}><span className={css.targetName} title={destination.target}>{destination.target}</span></button>
            {/* Stays open until applied (Enter), cancelled (Esc) or closed with the button:
              * a click elsewhere must not silently throw the typed name away. */}
            {editing && <div className={`${css.editor} ${alignEnd ? css.editorEnd : ''}`} ref={editor} role="dialog" aria-label={t('pushEditTarget')}>
              <div className={css.editorHead}>
                <label htmlFor="git-worktree-push-target">{t('pushBranch')}</label>
                <button type="button" className={css.editorClose} aria-label={t('pushEditTargetClose')} title={t('pushEditTargetClose')}
                  onClick={closeEditor}><IconCloseOutlineRegular size={12} /></button>
              </div>
              <input id="git-worktree-push-target" ref={input} value={draft} spellCheck={false} autoComplete="off"
                aria-invalid={draftIssue !== null && draftIssue !== 'empty'}
                onChange={event => { setDraft(event.target.value) }} onKeyDown={event => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  event.stopPropagation()
                  applyTarget()
                }} />
              <p className={css.hint}>{draftIssue === null || draftIssue === 'empty' ? t('pushApplyEnter') : t('menuNewBranchBad')}</p>
            </div>}
          </div>
        </div>}
        {preview?.targetOid === null && <span className={css.badge}>{t('pushNew')}</span>}
      </div>
      <div className={css.commits} aria-busy={displayPreview === undefined && error === null}>
        {displayPreview === undefined && knownTotal !== undefined && <div className={css.count}>
          {destination === null ? t(knownTotal === 1 ? 'aheadTitle.one' : 'aheadTitle.other', { n: knownTotal }) : commits(knownTotal)}
          <span className={css.previewStatus} role="status">{t(error === null ? 'pushReadingCommits' : 'pushLocalUnverified')}</span>
        </div>}
        {displayPreview === undefined && knownTotal === undefined && error === null && <p className={css.empty} role="status">{t(checking ? 'pushCheckingRemote' : 'pushPlanning')}</p>}
        {error !== null && <div className={css.error} role="alert">
          {failure !== null && <p className={css.errorSummary}>{t(FAILURE_KEYS[failure])}</p>}
          {/* Behind / stale are fully explained above. Everything else keeps git's own words, with the `git … failed (exit N):` command line removed even when the cause is not one this window names. */}
          {(failure === null || showsGitOutput(failure)) && <div className={failure === null ? undefined : css.errorDetail}>{gitOutput(error)}</div>}
        </div>}
        {displayPreview !== undefined && <>
          <div className={css.count}>{commits(displayPreview.total)}
            {preview === undefined && <span className={css.previewStatus} role="status">{t(checking ? 'pushLocalChecking' : 'pushLocalUnverified')}</span>}
          </div>
          {displayPreview.commits.length === 0 ? <p className={css.empty}>{t(preview === undefined ? 'pushLocalEmpty' : preview.targetOid === null ? 'pushNewEmpty' : 'pushEmpty')}</p>
            : <ul className={css.list} tabIndex={0} aria-label={t('pushCommitList')}>
              {displayPreview.commits.map(commit => <li key={commit.oid}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h4m6 0h4" /><circle cx="8" cy="8" r="3" /></svg>
                <span title={commit.subject}>{commit.subject}</span>
              </li>)}
            </ul>}
          {displayPreview.truncated && <p className={css.hint}>{t('pushTruncated', { n: displayPreview.commits.length })}</p>}
        </>}
      </div>
    </div>
    <footer className={css.footer}>
      <div className={css.tagOptions}>
        <label className={css.checkbox}><input type="checkbox" checked={tags} disabled={disabled}
          onChange={event => { setTags(event.target.checked) }} />{t('pushTags')}</label>
        <Menu open={menu === 'tags'} dense portal autoFocus side="top" selectedId={scope} onClose={() => { setMenu(null) }}
          items={[{ id: 'all', label: <span title={t('pushTagsAllHint')}>{t('pushTagsAll')}</span> },
            { id: 'follow', label: <span title={t('pushTagsFollowHint')}>{t('pushTagsFollow')}</span> }]}
          onSelect={id => { setScope(id as 'all' | 'follow'); setMenu(null) }}
          anchor={<button type="button" className={css.scope} disabled={disabled || !tags} aria-haspopup="menu" aria-expanded={menu === 'tags'}
            title={t(scope === 'all' ? 'pushTagsAllHint' : 'pushTagsFollowHint')}
            onClick={() => { setMenu(menu === 'tags' ? null : 'tags') }}>{t(scope === 'all' ? 'pushTagsAll' : 'pushTagsFollow')}<Chevron /></button>} />
      </div>
      <div className={css.actions}>
        {(error !== null || plan !== null) && <button type="button" className={css.refresh} disabled={disabled || editing} title={t('pushRefresh')}
          aria-label={t('pushRefresh')} onClick={refresh}>↻</button>}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={close}>{t('actionCancel')}</Button>
        <Menu open={menu === 'push'} dense portal autoFocus side="top" align="end" onClose={() => { setMenu(null) }}
          items={[{ id: 'force', label: <span title={t('pushForceHint')}>{t('pushForce')}</span>, disabled: !canPush }]}
          onSelect={() => { void submit(true) }} anchor={<div className={css.split}>
            <button type="button" className={css.push} data-modal-autofocus disabled={!canPush || nothingToPush}
              {...pushTitle === undefined ? {} : { title: pushTitle }}
              onClick={() => { void submit(false) }}>{t(disabled ? 'pushBusy' : 'ctxPush')}</button>
            <button type="button" className={css.splitArrow} disabled={!canPush} aria-label={t('pushOptions')} aria-haspopup="menu" aria-expanded={menu === 'push'}
              onClick={() => { setMenu(menu === 'push' ? null : 'push') }}><Chevron /></button>
          </div>} />
      </div>
    </footer>
  </Modal>
}
