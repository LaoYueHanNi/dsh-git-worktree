/**
 * Deferred worktree creation coordinator for shared-workspace mode
 * (`switchSessionDirectory`).
 *
 * When a user chooses to create a new worktree in shared-workspace mode, no
 * Git branch or checkout directory is written until the Session's first user
 * message actually arrives. On `agent/inbox/inserted`, the coordinator holds
 * the Agent via `agent.runMaintenance`, runs the plugin's full worktree
 * creation pipeline (`.git/info/exclude`, optional fetch, `git worktree add`,
 * `.worktreeinclude` copy, and `workingDirectory.set`), streams phase updates
 * to the browser dock, and lets the user retry or withdraw on failure without
 * losing the waiting message.
 */

import type {
  DeferredWorktreeCompleted,
  DeferredWorktreePhase,
  DeferredWorktreeSnapshot,
  DeferredWorktreeSpec,
  DeferredWorktreeState,
} from './wire.ts'

/** Minimal Host Agent slice needed to hold a turn and switch directory. */
export interface DeferredAgentLike {
  readonly session: { readonly id: string }
  readonly inbox?: {
    readonly nextTurn?: readonly { readonly id: string }[]
    readonly nextStep?: readonly { readonly id: string; readonly source?: { readonly kind?: string } }[]
    readonly remove?: (id: string) => void
  }
  readonly runMaintenance?: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>
}

/** Result of creating the worktree before switching the session directory. */
export interface DeferredCreateOutcome {
  readonly path: string
  readonly branch: string
  readonly created: boolean
  readonly fetchWarning?: string
  readonly excludeWarning?: string
  readonly copyWarning?: string
}

/** Host seams injected into {@link DeferredWorktreeCoordinator}. */
export interface DeferredCoordinatorDeps {
  /** Execute the plugin's worktree creation pipeline and report phase changes. */
  readonly createWorktree: (
    spec: DeferredWorktreeSpec,
    onPhase: (phase: Exclude<DeferredWorktreePhase, 'switch'>, resolvedBranch?: string) => void,
  ) => Promise<DeferredCreateOutcome>
  /** Move the Agent's working directory via DSH `ctx.workingDirectory.set`. */
  readonly setWorkingDirectory: (agent: DeferredAgentLike, path: string, signal?: AbortSignal) => Promise<string>
}

type FailureDecision = 'retry' | 'withdraw'

interface DeferredPromise<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason?: unknown) => void
}

function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface DeferredSlot {
  state: DeferredWorktreeState
  holding: boolean
  decision: DeferredPromise<FailureDecision> | undefined
}

type SnapshotListener = (snapshot: DeferredWorktreeSnapshot) => void

/**
 * Coordinates armed, running, and failed deferred worktree creations keyed by
 * `sessionId`. Pure in-process state machine with injectable seams.
 */
export class DeferredWorktreeCoordinator {
  private readonly slots = new Map<string, DeferredSlot>()
  private readonly listeners = new Map<string, Set<SnapshotListener>>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(private readonly deps: DeferredCoordinatorDeps) {}

  /** Read the current deferred state of `sessionId`, or null when none is active. */
  get(sessionId: string): DeferredWorktreeState | null {
    return this.slots.get(sessionId)?.state ?? null
  }

  /** Subscribe to live state/completion updates for `sessionId`. */
  subscribe(sessionId: string, listener: SnapshotListener): () => void {
    let set = this.listeners.get(sessionId)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(sessionId)
    }
  }

  /**
   * Arm (or replace) a deferred worktree creation on a blank session.
   * Rejects while a creation is already running on that session.
   */
  arm(sessionId: string, spec: DeferredWorktreeSpec): DeferredWorktreeState {
    const existing = this.slots.get(sessionId)
    if (existing !== undefined && existing.state.kind === 'running') {
      throw Object.assign(new Error('Worktree creation is already in progress for this session'), { httpStatus: 409 })
    }
    if (existing?.decision !== undefined) {
      existing.decision.resolve('withdraw')
      existing.decision = undefined
    }
    const state: DeferredWorktreeState = { kind: 'armed', spec }
    this.slots.set(sessionId, { state, holding: false, decision: undefined })
    this.emit(sessionId, { state })
    return state
  }

  /**
   * Cancel an armed request before any message arrives, or withdraw a failed
   * attempt so the waiting message continues in the current directory.
   */
  cancel(sessionId: string): boolean {
    const slot = this.slots.get(sessionId)
    if (slot === undefined) return false
    if (slot.state.kind === 'running') return false
    if (slot.decision !== undefined) {
      slot.decision.resolve('withdraw')
      slot.decision = undefined
      return true
    }
    this.slots.delete(sessionId)
    this.emit(sessionId, { state: null })
    return true
  }

  /** Retry a failed creation while the first message is waiting in maintenance. */
  retry(sessionId: string): boolean {
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot.state.kind !== 'failed' || slot.decision === undefined) return false
    const decision = slot.decision
    slot.decision = undefined
    decision.resolve('retry')
    return true
  }

  /** Withdraw a failed creation so the waiting message proceeds without a worktree. */
  withdraw(sessionId: string): boolean {
    return this.cancel(sessionId)
  }

  /**
   * Called from `agent/inbox/inserted`: if the session has an armed deferred
   * request, hold the Agent via `runMaintenance` so the worktree is created and
   * entered before the first turn starts.
   */
  onInboxInserted(agent: DeferredAgentLike, message?: { readonly id?: string }): void {
    if (this.lifetime.signal.aborted) return
    const sessionId = agent.session.id
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot.state.kind !== 'armed' || slot.holding) return
    // Ignore next-step internal notices when nextTurn queue info is available.
    if (
      message?.id !== undefined
      && Array.isArray(agent.inbox?.nextTurn)
      && !agent.inbox.nextTurn.some(queued => queued.id === message.id)
    ) {
      return
    }
    if (typeof agent.runMaintenance !== 'function') return

    let task: Promise<void>
    try {
      task = agent.runMaintenance(async (maintenanceSignal) => {
        // Yield a microtask so the inbox insertion finishes before touching the session.
        await Promise.resolve()
        const signal = AbortSignal.any([maintenanceSignal, this.lifetime.signal])
        await this.runLoop(sessionId, agent, slot, signal)
      })
    } catch {
      // Agent already busy with another turn/maintenance; pre-step fallback handles it if needed.
      return
    }
    slot.holding = true
    this.track(task.finally(() => {
      slot.holding = false
    }))
  }

  /**
   * Fallback for `agent/pre-step` (step === 1): if a message somehow bypassed
   * `agent/inbox/inserted` while an armed request is still pending, create and
   * enter the worktree right before the first model call.
   */
  async onPreStep(agent: DeferredAgentLike, step: number, signal?: AbortSignal): Promise<void> {
    if (step !== 1 || this.lifetime.signal.aborted) return
    const sessionId = agent.session.id
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot.state.kind !== 'armed' || slot.holding) return
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    await this.executeOnce(sessionId, agent, slot, combined)
  }

  /** Release any waiting maintenance holds when the plugin unloads. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('git-worktree plugin disposed'))
    for (const [sessionId, slot] of [...this.slots]) {
      slot.decision?.reject(this.lifetime.signal.reason)
      slot.decision = undefined
      this.slots.delete(sessionId)
      this.emit(sessionId, { state: null })
    }
    await Promise.allSettled(this.pending)
  }

  private async runLoop(
    sessionId: string,
    agent: DeferredAgentLike,
    slot: DeferredSlot,
    signal: AbortSignal,
  ): Promise<void> {
    for (;;) {
      if (this.slots.get(sessionId) !== slot) return
      if (signal.aborted) {
        this.clearSlot(sessionId, slot)
        return
      }
      try {
        await this.executeOnce(sessionId, agent, slot, signal)
        return
      } catch (error) {
        if (signal.aborted || this.slots.get(sessionId) !== slot) {
          this.clearSlot(sessionId, slot)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        const currentPhase: DeferredWorktreePhase = slot.state.kind === 'running' ? slot.state.phase : 'create'
        const resolvedBranch = slot.state.kind === 'running' ? slot.state.resolvedBranch : undefined
        slot.state = {
          kind: 'failed',
          spec: slot.state.spec,
          phase: currentPhase,
          message,
          ...(resolvedBranch === undefined ? {} : { resolvedBranch }),
        }
        this.emit(sessionId, { state: slot.state })
      }

      const decision = await this.waitForDecision(slot, signal)
      if (decision === 'withdraw' || this.slots.get(sessionId) !== slot) {
        this.clearSlot(sessionId, slot)
        return
      }
    }
  }

  private async executeOnce(
    sessionId: string,
    agent: DeferredAgentLike,
    slot: DeferredSlot,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    const spec = slot.state.spec
    const publishPhase = (phase: DeferredWorktreePhase, resolvedBranch?: string): void => {
      if (this.slots.get(sessionId) !== slot) return
      const nextBranch = resolvedBranch ?? (slot.state.kind === 'running' ? slot.state.resolvedBranch : undefined)
      slot.state = {
        kind: 'running',
        spec,
        phase,
        ...(nextBranch === undefined ? {} : { resolvedBranch: nextBranch }),
      }
      this.emit(sessionId, { state: slot.state })
    }

    publishPhase('create', spec.cutout ? spec.name : spec.branch)
    const created = await this.deps.createWorktree(spec, (phase, branch) => {
      publishPhase(phase, branch)
    })
    signal.throwIfAborted()

    publishPhase('switch', created.branch)
    const committedPath = await this.deps.setWorkingDirectory(agent, created.path, signal)
    signal.throwIfAborted()

    const completed: DeferredWorktreeCompleted = {
      path: committedPath,
      branch: created.branch,
      created: created.created,
      ...(created.fetchWarning === undefined ? {} : { fetchWarning: created.fetchWarning }),
      ...(created.excludeWarning === undefined ? {} : { excludeWarning: created.excludeWarning }),
      ...(created.copyWarning === undefined ? {} : { copyWarning: created.copyWarning }),
    }
    this.slots.delete(sessionId)
    this.emit(sessionId, { state: null, completed })
  }

  private async waitForDecision(slot: DeferredSlot, signal: AbortSignal): Promise<FailureDecision> {
    if (signal.aborted) return 'withdraw'
    const deferred = createDeferred<FailureDecision>()
    slot.decision = deferred
    const onAbort = (): void => { deferred.resolve('withdraw') }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await deferred.promise
    } catch {
      return 'withdraw'
    } finally {
      signal.removeEventListener('abort', onAbort)
      if (slot.decision === deferred) slot.decision = undefined
    }
  }

  private clearSlot(sessionId: string, slot: DeferredSlot): void {
    if (this.slots.get(sessionId) === slot) {
      this.slots.delete(sessionId)
      this.emit(sessionId, { state: null })
    }
  }

  private emit(sessionId: string, snapshot: DeferredWorktreeSnapshot): void {
    const set = this.listeners.get(sessionId)
    if (set === undefined) return
    for (const listener of [...set]) {
      try {
        listener(snapshot)
      } catch {
        // One broken stream listener must not break other observers.
      }
    }
  }

  private track(task: Promise<unknown>): void {
    this.pending.add(task)
    void task.finally(() => { this.pending.delete(task) })
  }
}
