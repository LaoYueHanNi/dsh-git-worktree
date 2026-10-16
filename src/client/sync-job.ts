/**
 * The fetch/update/push jobs in flight, kept outside React.
 *
 * A sync can run for minutes, and the composer that started it is not
 * guaranteed to outlive it: switching to another session unmounts the dock,
 * coming back mounts a new one. Component state would forget the job (and
 * happily start a second `git fetch` on top of the first); this store does
 * not. It is also the single-flight gate — one job per directory — and the
 * owner of the abort handle the card's cancel button pulls.
 *
 * It also holds on to a push that failed after its window had closed, until a
 * dock for that directory is there to show the reason again.
 *
 * Pure: no React, no DOM. The dock subscribes through `subscribeSyncJobs`.
 *
 * @module git-worktree/client/sync-job
 */

import type { PushBody, SyncEvent } from '../wire.ts'
import type { LiveCall } from './api.ts'

/** Which verb the job runs. */
export type SyncKind = 'fetch' | 'update' | 'push'

/** One running job, as the card shows it. Replaced, never mutated. */
export interface SyncJob {
  readonly id: number
  readonly kind: SyncKind
  /** The session directory the job runs for (the single-flight key). */
  readonly cwd: string
  /** `fetch` until the host announces the fast-forward step. */
  readonly stage: 'fetch' | 'merge'
  /** The branch the job is about when that is not the checked-out one (a
   * push names its own); absent = the checked-out branch. */
  readonly branch?: string
  /** git's latest progress line, as git wrote it; absent before the first. */
  readonly text?: string
  /** The `NN%` of that line, when it had one (a phase git cannot size has none). */
  readonly percent?: number
  /** The remote being fetched or pushed to, once known. */
  readonly remote?: string
}

/** What a job is about, known before git says anything. */
export interface SyncSubject {
  branch?: string
  remote?: string
}

/** A push that failed, with what it was asked to do — enough to put its
 * window back as the user left it, plus git's reason. */
export interface PushFailure {
  branch: string
  remote: string
  target: string
  tags: NonNullable<PushBody['tags']>
  error: string
}

/** What a finished job hands back. */
export interface SyncOutcome<T> {
  /** The route's answer (an abort surfaces here as a failed call). */
  result: T
  /** The user pressed cancel while the job ran. A job that had already
   * finished by then still reports its real result: check both. */
  cancelled: boolean
}

let jobs: readonly SyncJob[] = []
let lastId = 0
const aborts = new Map<string, AbortController>()
const listeners = new Set<() => void>()

function publish(next: readonly SyncJob[]): void {
  jobs = next
  for (const listener of [...listeners]) listener()
}

/**
 * The job running for a directory.
 * @param cwd - session directory; undefined has no job.
 */
export function findSyncJob(cwd: string | undefined): SyncJob | undefined {
  return cwd === undefined ? undefined : jobs.find(job => job.cwd === cwd)
}

/**
 * Be told whenever any job starts, advances or ends.
 * @param listener - called after the store changed.
 * @returns the unsubscribe.
 */
export function subscribeSyncJobs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Run one job for a directory. At most one job runs per directory.
 * @param cwd - session directory the job belongs to.
 * @param kind - which verb the card should say.
 * @param request - issues the streamed call with the live channel it is given.
 * @param subject - what the job is about, shown from the first moment.
 * @returns the outcome, or undefined when a job already runs for `cwd`
 * (nothing was started).
 */
export async function runSyncJob<T>(cwd: string, kind: SyncKind, request: (live: LiveCall) => Promise<T>, subject: SyncSubject = {}): Promise<SyncOutcome<T> | undefined> {
  if (aborts.has(cwd)) return undefined
  const controller = new AbortController()
  aborts.set(cwd, controller)
  const id = ++lastId
  const identity = { id, kind, cwd, ...subject.branch === undefined ? {} : { branch: subject.branch } }
  publish([...jobs, { ...identity, stage: 'fetch', ...subject.remote === undefined ? {} : { remote: subject.remote } }])

  const onEvent = (event: SyncEvent): void => {
    // After a cancel the card is on its way out; late lines must not repaint it.
    if (controller.signal.aborted) return
    const before = jobs.find(job => job.id === id)
    if (before === undefined) return
    // A line that does not name the remote keeps the one already known (a
    // fetch names each remote once, ahead of its counter lines; a push knew
    // its remote from the start).
    const remote = event.type === 'progress' ? event.remote ?? before.remote : undefined
    const next: SyncJob = event.type === 'merge'
      ? { ...identity, stage: 'merge' }
      : {
          ...identity, stage: 'fetch', text: event.text,
          ...event.percent === undefined ? {} : { percent: event.percent },
          ...remote === undefined ? {} : { remote },
        }
    publish(jobs.map(job => job.id === id ? next : job))
  }

  try {
    const result = await request({ signal: controller.signal, onEvent })
    return { result, cancelled: controller.signal.aborted }
  } finally {
    aborts.delete(cwd)
    publish(jobs.filter(job => job.id !== id))
  }
}

/**
 * Cancel the job running for a directory: the connection closes and the host
 * kills git. A job already past fetching (the quick fast-forward) is left to
 * finish — stopping it half way would only add a state to explain.
 * @param cwd - session directory.
 */
export function cancelSyncJob(cwd: string): void {
  if (findSyncJob(cwd)?.stage === 'merge') return
  aborts.get(cwd)?.abort()
}

const pushFailures = new Map<string, PushFailure>()

/**
 * Keep a failed push for a directory and tell the docks. The push window had
 * already closed (the card carried the push), so whichever dock is on that
 * directory — the one that started it, a later one, or one not yet mounted —
 * picks the failure up and reopens the window with git's reason.
 * @param cwd - session directory the push ran for.
 * @param failure - what was pushed and why it failed.
 */
export function recordPushFailure(cwd: string, failure: PushFailure): void {
  pushFailures.set(cwd, failure)
  for (const listener of [...listeners]) listener()
}

/**
 * Take the failed push waiting for a directory (it is forgotten once taken).
 * @param cwd - session directory; undefined has none.
 * @returns the failure, or undefined.
 */
export function takePushFailure(cwd: string | undefined): PushFailure | undefined {
  if (cwd === undefined) return undefined
  const failure = pushFailures.get(cwd)
  pushFailures.delete(cwd)
  return failure
}
