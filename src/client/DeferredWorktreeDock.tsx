/**
 * Composer-top dock card (`conversation.input.dock`) for deferred worktree
 * creation in shared-workspace mode (`switchSessionDirectory`).
 *
 * - `armed`: compact bar explaining that the worktree will be created on the
 *   first user message, with a one-click Cancel button (zero disk writes until
 *   the message is sent).
 * - `running`: live step progress card while the first turn waits in
 *   maintenance (`fetch` [optional] -> `create` -> `copy` -> `switch`).
 * - `failed`: failure card with phase indicator, branch/base/reason details,
 *   and Retry / Continue-without-worktree actions.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconBranchOutlineRegular, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DeferredWorktreeCompleted,
  DeferredWorktreePhase,
  DeferredWorktreeSnapshot,
  DeferredWorktreeSpec,
  DeferredWorktreeState,
} from '../wire.ts'
import { deferredWorktreeEventsUrl, fetchDeferredWorktree, requestDeferredWorktreeAction } from './api.ts'
import css from './DeferredWorktreeDock.module.css'

export interface DeferredWorktreeDockInjected {
  readonly sessionId?: string
  /** Whether this dock should probe the host for an existing deferred state on mount. */
  readonly shouldProbeDeferred?: (sessionId: string) => boolean
  readonly onDeferredCompleted?: (sessionId: string, completed: DeferredWorktreeCompleted) => void
}

type LocalDeferredListener = (state: DeferredWorktreeState | null) => void
const localDeferredListeners = new Map<string, Set<LocalDeferredListener>>()

/** Push a locally armed/cancelled deferred state to any mounted dock for `sessionId`. */
export function notifyDeferredWorktreeState(sessionId: string, state: DeferredWorktreeState | null): void {
  const listeners = localDeferredListeners.get(sessionId)
  if (listeners === undefined) return
  for (const listener of [...listeners]) listener(state)
}

function subscribeLocalDeferred(sessionId: string, listener: LocalDeferredListener): () => void {
  let set = localDeferredListeners.get(sessionId)
  if (set === undefined) {
    set = new Set()
    localDeferredListeners.set(sessionId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) localDeferredListeners.delete(sessionId)
  }
}

export type DeferredWorktreeDockProps = DeferredWorktreeDockInjected & PropsLocale<'git-worktree'>

type StepState = 'done' | 'running' | 'waiting' | 'failed'

function CheckMark(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.done}>
      <path d="M3 7.2L5.8 10L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StepIcon({ state }: { readonly state: StepState }): ReactNode {
  if (state === 'done') return <span className={css.stepMark}><CheckMark /></span>
  if (state === 'running') return <span className={css.stepMark} aria-hidden="true"><span className={css.runningDot} /></span>
  if (state === 'failed') return <span className={css.stepMark}><IconCloseOutlineRegular size={14} className={css.failed} /></span>
  return <span className={css.stepMark} aria-hidden="true"><span className={css.waitingRing} /></span>
}

function stepStateOf(
  phases: readonly DeferredWorktreePhase[],
  current: DeferredWorktreePhase,
  failed: boolean,
  phase: DeferredWorktreePhase,
): StepState {
  const at = phases.indexOf(current)
  const index = phases.indexOf(phase)
  if (index === at) return failed ? 'failed' : 'running'
  return index < at ? 'done' : 'waiting'
}

function describeArmedTarget(
  spec: DeferredWorktreeSpec,
  t: PropsLocale<'git-worktree'>['t'],
): string {
  if (spec.cutout) {
    const explicit = spec.name?.trim()
    if (explicit !== undefined && explicit !== '') {
      return t('deferred.armedCutout', { base: spec.branch, name: explicit })
    }
    return t('deferred.armedRandom', { base: spec.branch })
  }
  return t('deferred.armedBranch', { branch: spec.branch })
}

const PHASE_LABEL_KEY = {
  fetch: 'deferred.phaseFetch',
  create: 'deferred.phaseCreate',
  copy: 'deferred.phaseCopy',
  switch: 'deferred.phaseSwitch',
} as const satisfies Record<DeferredWorktreePhase, Parameters<PropsLocale<'git-worktree'>['t']>[0]>

/** Composer-top deferred worktree status & progress dock card. */
export function DeferredWorktreeDock({ sessionId, shouldProbeDeferred, onDeferredCompleted, t }: DeferredWorktreeDockProps): ReactNode {
  const [state, setState] = useState<DeferredWorktreeState | null>(null)
  const [acting, setActing] = useState(false)
  const [sawFetch, setSawFetch] = useState(false)
  const completedCallbackRef = useRef(onDeferredCompleted)
  completedCallbackRef.current = onDeferredCompleted
  const shouldProbeRef = useRef(shouldProbeDeferred)
  shouldProbeRef.current = shouldProbeDeferred

  const applySnapshot = useCallback((snapshot: DeferredWorktreeSnapshot, sid: string): void => {
    setState(snapshot.state)
    if (snapshot.state === null) {
      setSawFetch(false)
    } else if (snapshot.state.kind !== 'armed' && snapshot.state.phase === 'fetch') {
      setSawFetch(true)
    }
    if (snapshot.completed !== undefined) {
      completedCallbackRef.current?.(sid, snapshot.completed)
    }
  }, [])

  // Subscribe to local arm/cancel updates and run a one-shot GET probe on mount
  // only when deferred worktrees could be active (never holding an idle SSE).
  useEffect(() => {
    setState(null)
    setActing(false)
    setSawFetch(false)
    if (sessionId === undefined || sessionId === '') return

    let active = true
    const unsubLocal = subscribeLocalDeferred(sessionId, (nextState) => {
      if (!active) return
      applySnapshot({ state: nextState }, sessionId)
    })

    if (shouldProbeRef.current?.(sessionId) ?? true) {
      void fetchDeferredWorktree(sessionId).then((res) => {
        if (active && res.ok && res.state !== null) applySnapshot({ state: res.state }, sessionId)
      })
    }

    return () => {
      active = false
      unsubLocal()
    }
  }, [sessionId, applySnapshot])

  // Open an EventSource stream ONLY while this session has an active deferred
  // state (`armed`, `running`, or `failed`), and close it immediately once idle.
  const needsStream = state !== null
  useEffect(() => {
    if (!needsStream || sessionId === undefined || sessionId === '') return
    if (typeof EventSource !== 'function') return

    let active = true
    const source = new EventSource(deferredWorktreeEventsUrl(sessionId))
    source.onmessage = (event) => {
      if (!active) return
      try {
        const parsed = JSON.parse(event.data as string) as DeferredWorktreeSnapshot
        applySnapshot(parsed, sessionId)
      } catch {
        // Ignore malformed keepalive or partial frames.
      }
    }
    source.onerror = () => {
      // EventSource automatically reconnects; fetch once to avoid stale UI on brief drops.
      void fetchDeferredWorktree(sessionId).then((res) => {
        if (active && res.ok) applySnapshot({ state: res.state }, sessionId)
      })
    }
    return () => {
      active = false
      source.close()
    }
  }, [needsStream, sessionId, applySnapshot])

  const sendAction = useCallback((action: 'cancel' | 'retry' | 'withdraw'): void => {
    if (sessionId === undefined || acting) return
    setActing(true)
    void requestDeferredWorktreeAction(sessionId, action).then((res) => {
      if (res.ok) applySnapshot({ state: res.state }, sessionId)
    }).finally(() => {
      setActing(false)
    })
  }, [acting, applySnapshot, sessionId])

  if (state === null || sessionId === undefined) return null

  if (state.kind === 'armed') {
    return (
      <div className={css.dock} data-git-worktree-deferred="armed">
        <section className={`${css.card} ${css.armedCard}`} aria-label={t('deferred.armedTitle')}>
          <IconBranchOutlineRegular size={14} className={css.glyph} />
          <div className={css.armedInfo}>
            <span className={css.title}>{t('deferred.armedTitle')}</span>
            <span className={css.branch}>{describeArmedTarget(state.spec, t)}</span>
          </div>
          <Button size="sm" variant="ghost" disabled={acting} onClick={() => { sendAction('cancel') }}>
            {t('deferred.armedCancel')}
          </Button>
        </section>
      </div>
    )
  }

  const running = state.kind === 'running'
  const failed = state.kind === 'failed'
  const phases: DeferredWorktreePhase[] = sawFetch || state.phase === 'fetch'
    ? ['fetch', 'create', 'copy', 'switch']
    : ['create', 'copy', 'switch']
  const title = t(running ? 'deferred.runningTitle' : 'deferred.failedTitle')
  const branchBadge = state.resolvedBranch ?? (state.spec.cutout ? state.spec.name?.trim() : state.spec.branch)

  return (
    <div className={css.dock} data-git-worktree-deferred={running ? state.phase : 'failed'}>
      <section className={css.card} aria-label={title} aria-busy={running}>
        <div className={css.header}>
          <IconBranchOutlineRegular size={14} className={failed ? css.glyphFailed : css.glyph} />
          <span className={css.title}>{title}</span>
          {branchBadge !== undefined && branchBadge !== '' && (
            <span className={css.branch}>{branchBadge}</span>
          )}
        </div>
        <ul className={css.steps}>
          {phases.map((phase) => {
            const stepState = stepStateOf(phases, state.phase, failed, phase)
            return (
              <li key={phase} className={css.step} data-state={stepState}>
                <StepIcon state={stepState} />
                <span>{t(PHASE_LABEL_KEY[phase])}</span>
              </li>
            )
          })}
        </ul>
        {failed && (
          <dl className={css.details}>
            {branchBadge !== undefined && branchBadge !== '' && (
              <>
                <dt>{t('deferred.labelBranch')}</dt>
                <dd className={css.code}>{branchBadge}</dd>
              </>
            )}
            <dt>{t('deferred.labelBase')}</dt>
            <dd className={css.code}>{state.spec.branch}</dd>
            <dt>{t('deferred.labelReason')}</dt>
            <dd className={css.message}>{state.message}</dd>
          </dl>
        )}
        <p className={css.note}>{t('deferred.waitingNote')}</p>
        {failed && (
          <div className={css.footer}>
            <span className={css.actions}>
              <Button size="sm" variant="primary" disabled={acting} onClick={() => { sendAction('retry') }}>
                {t('deferred.retry')}
              </Button>
              <Button size="sm" variant="ghost" disabled={acting} onClick={() => { sendAction('withdraw') }}>
                {t('deferred.withdraw')}
              </Button>
            </span>
          </div>
        )}
      </section>
    </div>
  )
}
