/**
 * CheckoutPrModal: checkout a GitHub PR or GitLab MR into an isolated Git worktree.
 * Supports optional `ctx.forge` candidate lists & metadata preview with automatic
 * fallback to zero-dependency native `git fetch refs/pull|merge-requests`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Tag, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DeferredWorktreeSpec,
  PrCandidateItem,
  PrContextResult,
  PrProviderKind,
  PrResolveResult,
} from '../wire.ts'
import { requestPrCheckout, requestPrContext, requestPrResolve } from './api.ts'
import { formatPrError } from './pr-error.ts'
import { isPathWithinWorktree } from './session-directory.ts'
import type { AdoptWorktreeOptions } from './slots.ts'
import { emitToast } from './toast-bus.ts'
import type { PruneSummaryLike } from './WorktreeActionHost.tsx'
import css from './CheckoutPrModal.module.css'

type Translate = PropsLocale<'git-worktree'>['t']

/** Reusable PR/MR vector glyph shared across BranchMenu toolbar and Forge slot entries. */
export function PrCheckoutGlyph({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="12.5" r="1.5" />
      <path d="M4 5v6" strokeLinecap="round" />
      <path d="M12 11V6.5a2 2 0 0 0-2-2H8" strokeLinecap="round" />
      <path d="M9.6 3.1L8 4.5l1.6 1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface CheckoutPrModalProps {
  readonly repoPath: string
  readonly repoName: string
  readonly initialInput?: string
  readonly reuseBlankSessionId?: string
  readonly initialIfExists?: 'reuse' | 'update'
  readonly forgeTrackAvailable: boolean
  readonly adoptWorktree: (path: string, options?: AdoptWorktreeOptions) => Promise<void>
  readonly isSwitchSessionDirectory?: (() => boolean) | undefined
  readonly armDeferredWorktree?: ((spec: DeferredWorktreeSpec, options?: AdoptWorktreeOptions) => Promise<void>) | undefined
  readonly currentSessionPath?: (() => string | undefined) | undefined
  readonly hasStandaloneWorkspace?: ((path: string) => boolean) | undefined
  readonly trackCurrentSessionPr?: ((url: string) => void) | undefined
  readonly pruneWorktrees?: ((createdPath: string) => Promise<PruneSummaryLike | undefined>) | undefined
  readonly onCreated: (path: string) => void
  readonly onClose: () => void
  readonly t: Translate
}

type FilterKind = 'all' | 'review-requested' | 'authored' | 'involved'

/** Pure filter helper exported for unit testing. */
export function filterPrCandidates(
  candidates: readonly PrCandidateItem[],
  filter: FilterKind,
  query: string,
): PrCandidateItem[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '') {
    return filter === 'all' ? [...candidates] : candidates.filter(item => item.filter === filter)
  }
  const needle = trimmed.replace(/^[#!]/, '')
  return candidates.filter(item =>
    String(item.number).includes(needle)
    || item.title.toLowerCase().includes(trimmed)
    || (item.author?.toLowerCase().includes(trimmed) ?? false)
    || item.url.toLowerCase().includes(trimmed),
  )
}

/** True when user input looks like an explicit PR/MR number or URL rather than a candidate list search keyword. */
export function looksLikePrTarget(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed === '') return false
  return /^[#!]?\d+$/.test(trimmed) || /^https?:\/\//i.test(trimmed)
}

function ciText(checksRollup: PrCandidateItem['checksRollup'], t: Translate): string | null {
  if (checksRollup === 'success') return t('prModal.ciSuccess')
  if (checksRollup === 'pending') return t('prModal.ciPending')
  if (checksRollup === 'failure') return t('prModal.ciFailure')
  return null
}

function ciDotClass(checksRollup: PrCandidateItem['checksRollup']): string {
  if (checksRollup === 'success') return css.dotSafe ?? ''
  if (checksRollup === 'pending') return css.dotPending ?? ''
  if (checksRollup === 'failure') return css.dotWarn ?? ''
  return css.dotNeutral ?? ''
}

/** Modal for resolving and checking out a PR/MR into a dedicated worktree. */
export function CheckoutPrModal({
  repoPath,
  repoName,
  initialInput,
  reuseBlankSessionId,
  initialIfExists,
  forgeTrackAvailable,
  adoptWorktree,
  isSwitchSessionDirectory,
  armDeferredWorktree,
  currentSessionPath,
  hasStandaloneWorkspace,
  trackCurrentSessionPr,
  pruneWorktrees,
  onCreated,
  onClose,
  t,
}: CheckoutPrModalProps) {
  const [context, setContext] = useState<PrContextResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [switchingRemote, setSwitchingRemote] = useState(false)
  const [query, setQuery] = useState(initialInput ?? '')
  const [selectedCandidate, setSelectedCandidate] = useState<PrCandidateItem | null>(null)
  const [remote, setRemote] = useState<string>('')
  const [providerOverride, setProviderOverride] = useState<PrProviderKind | ''>('')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [resolved, setResolved] = useState<PrResolveResult | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [ifExists, setIfExists] = useState<'reuse' | 'update'>(initialIfExists ?? 'reuse')
  const [divergedPrompt, setDivergedPrompt] = useState(false)
  const [autoTrack, setAutoTrack] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyMode, setBusyMode] = useState<'create' | 'open' | 'update'>('create')
  const [stageText, setStageText] = useState<string | null>(null)
  const [progressPercent, setProgressPercent] = useState<number | null>(null)
  const [progressLog, setProgressLog] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const remoteSwitchAbortRef = useRef<AbortController | null>(null)
  const resolvedTargetKeyRef = useRef<string | null>(null)
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const controller = new AbortController()
    setContext(null)
    setLoadError(null)
    setSwitchingRemote(false)
    setSelectedCandidate(null)
    setRemote('')
    setProviderOverride('')
    setQuery(initialInput ?? '')
    setResolved(null)
    setResolveError(null)
    setResolving(false)
    setIfExists(initialIfExists ?? 'reuse')
    setDivergedPrompt(false)
    setCheckoutError(null)
    resolvedTargetKeyRef.current = null
    void requestPrContext(repoPath, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) {
        setLoadError(formatPrError(result.error, result.code, result.params, tRef.current))
        return
      }
      setContext(result)
      setRemote(result.defaultRemote ?? result.remotes[0]?.name ?? '')
      setFilter('all')
    })
    return () => {
      controller.abort()
      remoteSwitchAbortRef.current?.abort()
    }
  }, [repoPath, initialInput, initialIfExists])

  useEffect(() => {
    if (context !== null) inputRef.current?.focus()
  }, [context])

  useEffect(() => () => {
    abortRef.current?.abort()
    remoteSwitchAbortRef.current?.abort()
  }, [])

  const forgeReady = context?.forge.available === true && context.forge.readiness === 'ready'
  const hasCandidateList = forgeReady && (context?.candidates.length ?? 0) > 0

  const effectiveInput = selectedCandidate !== null ? selectedCandidate.url : query.trim()
  const effectiveRemote = selectedCandidate !== null ? selectedCandidate.remote : remote

  const selectedRemoteInfo = useMemo(
    () => context?.remotes.find(r => r.name === effectiveRemote),
    [context, effectiveRemote],
  )
  const needsProviderPicker = useMemo(() => {
    return selectedCandidate === null
      && /^[#!]?\d+$/.test(effectiveInput)
      && selectedRemoteInfo?.provider === null
  }, [selectedCandidate, effectiveInput, selectedRemoteInfo])
  const defaultPickerProvider: PrProviderKind = effectiveInput.startsWith('!') ? 'gitlab' : 'github'
  const effectiveProvider: PrProviderKind | undefined = needsProviderPicker
    ? (providerOverride || defaultPickerProvider)
    : undefined

  useEffect(() => {
    if (context === null || context.remotes.length === 0) return
    if (effectiveInput === '') {
      resolvedTargetKeyRef.current = null
      setResolved(null)
      setResolveError(null)
      setResolving(false)
      setDivergedPrompt(false)
      return
    }
    // When Forge candidates are visible, plain text words act as live list filters instead of erroring `/pr-resolve`.
    if (selectedCandidate === null && hasCandidateList && !looksLikePrTarget(effectiveInput)) {
      resolvedTargetKeyRef.current = null
      setResolved(null)
      setResolveError(null)
      setResolving(false)
      setDivergedPrompt(false)
      return
    }
    const controller = new AbortController()
    setResolved(null)
    setResolving(true)
    setResolveError(null)
    setDivergedPrompt(false)
    const timer = setTimeout(() => {
      void requestPrResolve({
        repoPath,
        input: effectiveInput,
        ...(effectiveRemote === '' ? {} : { remote: effectiveRemote }),
        ...(effectiveProvider === undefined ? {} : { provider: effectiveProvider }),
        ...(selectedCandidate === null ? {} : { verifyRemote: false }),
      }, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setResolving(false)
        if (!result.ok) {
          resolvedTargetKeyRef.current = null
          setResolved(null)
          setResolveError(formatPrError(result.error, result.code, result.params, tRef.current))
          return
        }
        const targetKey = `${result.remote}:${result.provider}:${result.number}`
        setResolved(result)
        if (resolvedTargetKeyRef.current !== targetKey) {
          resolvedTargetKeyRef.current = targetKey
          setIfExists(initialIfExists ?? 'reuse')
        }
      })
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [context, repoPath, effectiveInput, effectiveRemote, effectiveProvider, selectedCandidate, hasCandidateList, initialIfExists])

  const counts = useMemo(() => {
    const map: Record<FilterKind, number> = {
      all: context?.candidates.length ?? 0,
      'review-requested': 0,
      authored: 0,
      involved: 0,
    }
    for (const item of context?.candidates ?? []) map[item.filter] += 1
    return map
  }, [context])

  const visibleCandidates = useMemo(
    () => filterPrCandidates(context?.candidates ?? [], filter, query),
    [context, filter, query],
  )

  const matchedCandidate = useMemo(() => {
    if (resolved === null) return selectedCandidate
    if (
      selectedCandidate !== null
      && selectedCandidate.provider === resolved.provider
      && selectedCandidate.number === resolved.number
      && selectedCandidate.remote === resolved.remote
    ) {
      return selectedCandidate
    }
    return context?.candidates.find(
      c => c.provider === resolved.provider && c.number === resolved.number && c.remote === resolved.remote,
    ) ?? null
  }, [resolved, selectedCandidate, context])

  const handleRemoteChange = (nextRemote: string, options?: { readonly preserveSelection?: boolean }): void => {
    const preserve = options?.preserveSelection === true
    setRemote(nextRemote)
    if (!preserve) {
      setProviderOverride('')
      setSelectedCandidate(null)
      setResolved(null)
      setResolveError(null)
    }
    setCheckoutError(null)
    setDivergedPrompt(false)
    if (context === null) return
    remoteSwitchAbortRef.current?.abort()
    const controller = new AbortController()
    remoteSwitchAbortRef.current = controller
    setSwitchingRemote(true)
    void requestPrContext(repoPath, { remote: nextRemote, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      setSwitchingRemote(false)
      if (!result.ok) {
        const message = formatPrError(result.error, result.code, result.params, tRef.current)
        setContext(prev => (prev === null
          ? null
          : {
              ...prev,
              candidates: [],
              forge: prev.forge.available
                ? { available: true, readiness: 'unavailable', message }
                : prev.forge,
            }))
        setCheckoutError(message)
        return
      }
      setContext(result)
      if (filter !== 'all' && !result.candidates.some(c => c.filter === filter)) {
        setFilter('all')
      }
    })
  }

  const handleClose = (): void => {
    if (busy) {
      if (abortRef.current !== null) {
        abortRef.current.abort()
        return
      }
    }
    onClose()
  }

  const executeCheckout = (modeOverride?: 'reuse' | 'update' | 'reset'): void => {
    if (busy || resolved === null || resolved.occupiedByMain === true) return
    const effectiveMode = modeOverride ?? (resolved.existingWorktreePath === undefined ? undefined : ifExists)
    const canDeferPr = isSwitchSessionDirectory?.() === true && armDeferredWorktree !== undefined
    const alreadyInTargetWorktree = resolved.existingWorktreePath !== undefined
      && isPathWithinWorktree(currentSessionPath?.(), resolved.existingWorktreePath)
    const hasExistingStandalone = resolved.existingWorktreePath !== undefined
      && hasStandaloneWorkspace?.(resolved.existingWorktreePath) === true
    const shouldDeferAfterAction = canDeferPr && !alreadyInTargetWorktree && !hasExistingStandalone
    const buildTrackUrl = (canonical: string | null | undefined): string | null =>
      autoTrack && forgeTrackAvailable ? (canonical ?? null) : null
    const armPrDeferred = (mode: 'reuse' | 'update' | 'reset' | undefined, canonical: string | null | undefined): Promise<void> => {
      const trackUrl = buildTrackUrl(canonical)
      return armDeferredWorktree!(
        {
          repoPath,
          branch: resolved.localBranch,
          cutout: false,
          pr: {
            input: effectiveInput,
            remote: resolved.remote,
            provider: resolved.provider,
            ...(mode === undefined ? {} : { ifExists: mode }),
            canonicalUrl: trackUrl,
          },
        },
        {
          ...(reuseBlankSessionId === undefined ? {} : { reuseBlankSessionId }),
          ...(context === null ? {} : { repoRoot: context.repoRoot }),
        },
      )
    }

    if (shouldDeferAfterAction && (resolved.existingWorktreePath === undefined || effectiveMode === 'reuse')) {
      setBusy(true)
      setBusyMode(effectiveMode === 'reuse' ? 'open' : 'create')
      setCheckoutError(null)
      setDivergedPrompt(false)
      void armPrDeferred(effectiveMode, resolved.canonicalUrl).then(
        () => {
          onClose()
        },
        (reason: unknown) => {
          setBusy(false)
          setCheckoutError(reason instanceof Error ? reason.message : String(reason))
        },
      )
      return
    }

    const nextBusyMode = effectiveMode === 'reuse'
      ? 'open'
      : effectiveMode === 'update' || effectiveMode === 'reset'
        ? 'update'
        : 'create'
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setBusyMode(nextBusyMode)
    setCheckoutError(null)
    setDivergedPrompt(false)
    setStageText(resolved.existingWorktreePath !== undefined && effectiveMode === 'reuse' ? null : t('prModal.stageFetch'))
    setProgressPercent(null)
    setProgressLog(null)

    void requestPrCheckout({
      repoPath,
      input: effectiveInput,
      remote: resolved.remote,
      provider: resolved.provider,
      ...(effectiveMode === undefined ? {} : { ifExists: effectiveMode }),
    }, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'stage') {
          setStageText(
            event.stage === 'fetch'
              ? t('prModal.stageFetch')
              : event.stage === 'worktree'
                ? t('prModal.stageWorktree')
                : t('prModal.stageCopy'),
          )
        } else if (event.type === 'progress') {
          if (event.percent !== undefined) setProgressPercent(event.percent)
          setProgressLog(event.text)
        }
      },
    }).then(
      async (result) => {
        abortRef.current = null
        if (controller.signal.aborted) {
          setBusy(false)
          return
        }
        if (!result.ok) {
          setBusy(false)
          if (result.code === 'worktree_diverged') {
            setDivergedPrompt(true)
            return
          }
          setCheckoutError(formatPrError(result.error, result.code, result.params, tRef.current))
          return
        }
        try {
          onCreated(result.path)
          if (alreadyInTargetWorktree && !result.created) {
            const trackUrl = buildTrackUrl(result.canonicalUrl)
            if (trackUrl !== null) trackCurrentSessionPr?.(trackUrl)
          } else if (shouldDeferAfterAction) {
            await armPrDeferred('reuse', result.canonicalUrl)
          } else {
            const trackUrl = buildTrackUrl(result.canonicalUrl)
            const adoptOptions: AdoptWorktreeOptions = {
              ...(reuseBlankSessionId === undefined ? {} : { reuseBlankSessionId }),
              ...(context === null ? {} : { repoRoot: context.repoRoot }),
              ...(trackUrl === null ? {} : { trackPrUrl: trackUrl }),
            }
            await adoptWorktree(result.path, Object.keys(adoptOptions).length === 0 ? undefined : adoptOptions)
          }
          if (result.reset === true) emitToast(t('prModal.resetToast', { branch: result.branch }), 'success')
          else if (result.forceUpdated === true) emitToast(t('prModal.forceUpdatedToast', { branch: result.branch }), 'success')
          else if (result.updated === true) emitToast(t('prModal.updatedToast', { branch: result.branch }), 'success')
          else if (result.updated === false) emitToast(t('prModal.upToDateToast', { branch: result.branch }), 'success')
          if (result.preservedLocalBranch === true) {
            emitToast(t('prModal.preservedLocalBranchToast', { branch: result.branch }))
          }
          if (result.fetchWarning !== undefined) emitToast(t('fetchWarning', { message: result.fetchWarning }))
          if (result.excludeWarning !== undefined) emitToast(t('excludeWarning', { message: result.excludeWarning }))
          if (result.copyWarning !== undefined) emitToast(t('copyWarning', { message: result.copyWarning }))
          if (pruneWorktrees !== undefined && result.created) {
            void pruneWorktrees(result.path).then((report) => {
              if (report === undefined) return
              if (report.removed.length > 0) emitToast(t('pruneDone', { n: report.removed.length }))
              if (report.failed.length > 0) emitToast(t('pruneFailed', { n: report.failed.length }))
            })
          }
          onClose()
        } catch (reason: unknown) {
          setBusy(false)
          setCheckoutError(reason instanceof Error ? reason.message : String(reason))
        }
      },
      (reason: unknown) => {
        abortRef.current = null
        setBusy(false)
        setCheckoutError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  const submitLabel = busy
    ? (busyMode === 'open'
        ? t('prModal.busyOpen')
        : busyMode === 'update'
          ? t('prModal.busyUpdate')
          : t('prModal.busy'))
    : resolved?.existingWorktreePath !== undefined
      ? (ifExists === 'update' ? t('prModal.submitUpdate') : t('prModal.submitOpen'))
      : t('prModal.submitCreate')

  const canSubmit = !busy
    && !resolving
    && resolved !== null
    && resolved.occupiedByMain !== true
    && (context?.remotes.length ?? 0) > 0

  const previewTitleText = resolved === null
    ? null
    : resolved.meta !== undefined
      ? `#${resolved.number} · ${resolved.meta.title}`
      : matchedCandidate !== null
        ? `#${resolved.number} · ${matchedCandidate.title}`
        : t('prModal.previewHeading')

  const previewAuthor = resolved?.meta?.author ?? matchedCandidate?.author ?? null
  const previewDraft = resolved?.meta?.draft ?? matchedCandidate?.draft ?? false
  const previewStateLabel = resolved?.meta?.state === 'merged'
    ? t('prModal.tagMerged')
    : resolved?.meta?.state === 'closed'
      ? t('prModal.tagClosed')
      : null
  const previewChecks = matchedCandidate === null ? null : matchedCandidate.checksRollup
  const previewCi = previewChecks === null ? null : ciText(previewChecks, t)

  return (
    <Modal
      open
      onClose={handleClose}
      closeLabel={t('close')}
      title={t('prModal.title', { repo: repoName })}
      className={css.dialog ?? ''}
      footer={(
        <div className={css.footerWrap}>
          {forgeTrackAvailable && (
            <label className={css.radioLabel}>
              <input
                type="checkbox"
                checked={autoTrack}
                disabled={busy}
                onChange={(event) => { setAutoTrack(event.target.checked) }}
              />
              <span>{t('prModal.autoTrack')}</span>
            </label>
          )}
          <div className={css.footerButtons}>
            <Button variant="outline" onClick={handleClose}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={() => { executeCheckout() }}
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      )}
    >
      <div className={css.body}>
        <p className={css.subtitle}>{t('prModal.subtitle')}</p>

        {context === null && loadError === null && (
          <div className={css.status} role="status">{t('prModal.loading')}</div>
        )}
        {loadError !== null && (
          <div className={css.error} role="alert">{t('prModal.loadFailed', { message: loadError })}</div>
        )}

        {context !== null && context.remotes.length === 0 && (
          <div className={css.error} role="alert">{t('prModal.noRemotes')}</div>
        )}

        {context !== null && context.remotes.length > 0 && (
          <>
            {context.forge.readiness === 'unauthenticated' && (
              <div className={css.banner}>
                <span>{t('prModal.forgeUnauth')}</span>
                {context.forge.signInCommand !== undefined && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void writeClipboard(context.forge.signInCommand!).then((ok) => {
                        if (ok) emitToast(t('hover.copied'), 'success')
                      })
                    }}
                  >
                    {t('copy')}
                  </Button>
                )}
              </div>
            )}

            {context.forge.available && context.forge.readiness === 'unavailable' && (
              <div className={css.banner}>
                <span>
                  {context.forge.listUnsupported === true
                    ? t('prModal.forgeListUnsupported')
                    : context.forge.message !== undefined && context.forge.message.trim() !== ''
                      ? t('prModal.forgeUnavailableWithReason', { message: context.forge.message })
                      : t('prModal.forgeUnavailable')}
                </span>
              </div>
            )}

            <div className={css.controlsRow}>
              <input
                ref={inputRef}
                type="text"
                className={css.input}
                value={query}
                disabled={busy}
                placeholder={t('prModal.inputPlaceholder')}
                aria-label={t('prModal.inputPlaceholder')}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSelectedCandidate(null)
                  setResolved(null)
                  setResolveError(null)
                  setCheckoutError(null)
                  setDivergedPrompt(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && canSubmit) {
                    event.preventDefault()
                    executeCheckout()
                  }
                }}
              />
              {context.remotes.length > 1 && (
                <select
                  className={css.select}
                  aria-label={t('prModal.remoteLabel')}
                  value={remote}
                  disabled={busy}
                  onChange={(event) => { handleRemoteChange(event.target.value) }}
                >
                  {context.remotes.map(item => (
                    <option key={item.name} value={item.name}>
                      {item.owner !== null && item.repo !== null ? `${item.name} (${item.owner}/${item.repo})` : item.name}
                    </option>
                  ))}
                </select>
              )}
              {needsProviderPicker && (
                <select
                  className={css.select}
                  aria-label={t('prModal.providerLabel')}
                  value={effectiveProvider ?? defaultPickerProvider}
                  disabled={busy}
                  onChange={(event) => {
                    setProviderOverride(event.target.value as PrProviderKind)
                    setResolved(null)
                    setResolveError(null)
                  }}
                >
                  <option value="github">{t('prModal.providerGithub')}</option>
                  <option value="gitlab">{t('prModal.providerGitlab')}</option>
                </select>
              )}
            </div>

            {switchingRemote && (
              <div className={css.status} role="status">{t('prModal.loadingRemote', { remote })}</div>
            )}

            {forgeReady && (
              <>
                <div className={css.filterRow}>
                  <div className={css.filterTabs} role="tablist">
                    {([
                      ['all', 'prModal.filterAll'],
                      ['review-requested', 'prModal.filterReviewRequested'],
                      ['authored', 'prModal.filterAuthored'],
                      ['involved', 'prModal.filterInvolved'],
                    ] as const).map(([key, labelKey]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={filter === key}
                        className={filter === key ? `${css.filterTab} ${css.filterTabActive}` : css.filterTab}
                        disabled={busy}
                        onClick={() => { setFilter(key) }}
                      >
                        {t(labelKey, { n: counts[key] })}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={css.refreshTab}
                    disabled={busy || switchingRemote}
                    onClick={() => { handleRemoteChange(remote, { preserveSelection: true }) }}
                  >
                    {t('prModal.refreshCandidates')}
                  </button>
                </div>

                <div className={css.candidateList} role="listbox">
                  {visibleCandidates.length === 0 ? (
                    <div className={css.emptyList}>
                      {counts.all === 0 ? t('prModal.emptyRepoCandidates') : t('prModal.noCandidates')}
                    </div>
                  ) : visibleCandidates.map((item) => {
                    const trimmedQuery = query.trim()
                    const normalizedNum = trimmedQuery.replace(/^[#!]/, '')
                    const selected = (selectedCandidate !== null && selectedCandidate.provider === item.provider && selectedCandidate.number === item.number && selectedCandidate.remote === item.remote)
                      || (selectedCandidate === null && item.remote === remote && (trimmedQuery === item.url || normalizedNum === String(item.number)))
                    const checks = ciText(item.checksRollup, t)
                    return (
                      <button
                        key={`${item.provider}:${item.number}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={busy}
                        className={selected ? `${css.candidateRow} ${css.candidateRowSelected}` : css.candidateRow}
                        onClick={() => {
                          remoteSwitchAbortRef.current?.abort()
                          remoteSwitchAbortRef.current = null
                          setSwitchingRemote(false)
                          setSelectedCandidate(item)
                          setRemote(item.remote)
                          setProviderOverride('')
                          setCheckoutError(null)
                          setDivergedPrompt(false)
                        }}
                      >
                        <div className={css.candidateTop}>
                          <span className={css.candidateNum}>#{item.number}</span>
                          <span className={css.candidateTitle}>{item.title}</span>
                          {item.draft && <Tag tone="neutral">{t('prModal.tagDraft')}</Tag>}
                          {item.existingWorktreePath !== undefined && (
                            <Tag tone="neutral">{t('prModal.tagWorktree')}</Tag>
                          )}
                        </div>
                        <div className={css.candidateMeta}>
                          <span>{item.author ?? item.owner}</span>
                          {checks !== null && (
                            <span className={css.ciBadge}>
                              <span className={ciDotClass(item.checksRollup)} aria-hidden="true" />
                              <span>{checks}</span>
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {resolving && <div className={css.status} role="status">{t('prModal.resolving')}</div>}
            {resolveError !== null && <div className={css.error} role="alert">{resolveError}</div>}

            {resolved !== null && (
              <div className={css.previewCard}>
                {resolved.occupiedByMain === true ? (
                  <div className={css.error} role="alert">
                    {t('prModal.occupiedByMain', { branch: resolved.localBranch })}
                  </div>
                ) : resolved.existingWorktreePath !== undefined ? (
                  <>
                    <div className={css.previewHeader}>
                      <span className={css.previewTitle}>
                        {t('prModal.existingHeading', { branch: resolved.localBranch })}
                      </span>
                      {previewDraft && <Tag tone="neutral">{t('prModal.tagDraft')}</Tag>}
                      {previewStateLabel !== null && <Tag tone="neutral">{previewStateLabel}</Tag>}
                    </div>
                    {previewTitleText !== null && previewTitleText !== t('prModal.previewHeading') && (
                      <div className={css.previewLine}>{previewTitleText}</div>
                    )}
                    <dl className={css.previewDl}>
                      <dt>{t('prModal.labelExistingPath')}</dt>
                      <dd title={resolved.existingWorktreePath}>{resolved.existingWorktreePath}</dd>
                    </dl>
                    <div className={css.existingOptions}>
                      <label className={ifExists === 'reuse' ? `${css.radioCard} ${css.radioCardSelected}` : css.radioCard}>
                        <input
                          type="radio"
                          name="pr-if-exists"
                          checked={ifExists === 'reuse'}
                          disabled={busy}
                          onChange={() => {
                            setIfExists('reuse')
                            setDivergedPrompt(false)
                            setCheckoutError(null)
                          }}
                        />
                        <span>{t('prModal.existingReuse')}</span>
                      </label>
                      <label className={ifExists === 'update' ? `${css.radioCard} ${css.radioCardSelected}` : css.radioCard}>
                        <input
                          type="radio"
                          name="pr-if-exists"
                          checked={ifExists === 'update'}
                          disabled={busy}
                          onChange={() => {
                            setIfExists('update')
                            setDivergedPrompt(false)
                            setCheckoutError(null)
                          }}
                        />
                        <span>{t('prModal.existingUpdate')}</span>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={css.previewHeader}>
                      <span className={css.previewTitle}>{previewTitleText}</span>
                      {previewDraft && <Tag tone="neutral">{t('prModal.tagDraft')}</Tag>}
                      {previewStateLabel !== null && <Tag tone="neutral">{previewStateLabel}</Tag>}
                    </div>
                    {(previewAuthor !== null || previewCi !== null) && (
                      <div className={css.candidateMeta}>
                        <span>{previewAuthor ?? ''}</span>
                        {previewCi !== null && previewChecks !== null && (
                          <span className={css.ciBadge}>
                            <span className={ciDotClass(previewChecks)} aria-hidden="true" />
                            <span>{previewCi}</span>
                          </span>
                        )}
                      </div>
                    )}
                    <dl className={css.previewDl}>
                      <dt>{t('prModal.labelRef')}</dt>
                      <dd>{`${resolved.remote} ${resolved.refSpec}`}</dd>
                      <dt>{t('prModal.labelBranch')}</dt>
                      <dd>{resolved.localBranch}</dd>
                      <dt>{t('prModal.labelPath')}</dt>
                      <dd title={resolved.targetPath}>{resolved.targetPath}</dd>
                    </dl>
                    <div className={css.infoNote}>
                      <span className={css.dotNeutral} aria-hidden="true" />
                      <span>{t('prModal.forkPushNote')}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {divergedPrompt && resolved !== null && (
              <div className={css.divergedCard} role="alert">
                <div className={css.divergedHead}>
                  <span className={css.dotWarn} aria-hidden="true" />
                  <span className={css.divergedTitle}>{t('prModal.divergedTitle', { branch: resolved.localBranch })}</span>
                </div>
                <div className={css.divergedDesc}>{t('prModal.divergedDesc')}</div>
                <div className={css.divergedActions}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => { executeCheckout('reuse') }}
                  >
                    {t('prModal.divergedKeep')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={css.dangerButton ?? ''}
                    disabled={busy}
                    onClick={() => { executeCheckout('reset') }}
                  >
                    {t('prModal.divergedReset')}
                  </Button>
                </div>
              </div>
            )}

            {busy && (
              <div className={css.progressCard} role="status">
                <div className={css.previewTitle}>{stageText ?? t('prModal.busy')}</div>
                {progressPercent !== null && (
                  <div className={css.progressTrack}>
                    <div className={css.progressFill} style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }} />
                  </div>
                )}
                {progressLog !== null && <div className={css.progressLog}>{progressLog}</div>}
              </div>
            )}

            {checkoutError !== null && <div className={css.error} role="alert">{checkoutError}</div>}
          </>
        )}
      </div>
    </Modal>
  )
}
