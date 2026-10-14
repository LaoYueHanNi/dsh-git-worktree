/**
 * Shared poll of the checked-out branch while the page is visible.
 *
 * One timer for every branch label. Subscribers on the same directory share
 * one request per tick. The tick only reports a branch name; the label
 * decides whether that name is news. Hidden pages do not tick. A directory
 * watch was declined: git replaces HEAD by rename, which drops a file watch
 * on Windows, and the poll does not need a push channel.
 */

import { fetchHead } from './api.ts'
import type { HeadStatus } from '../wire.ts'

/** How often a visible page re-reads HEAD. Long enough to be idle noise,
 * short enough that a checkout in this same window shows up on the label. */
export const HEAD_POLL_MS = 5000

/** Bound a slow directory's read without delaying any other directory. */
export const HEAD_POLL_TIMEOUT_MS = 5000

/** What {@link fetchHead} resolves to, plus a thrown failure the poller swallows. */
type HeadResult =
  | (HeadStatus & { ok: true })
  | { ok: false; error: string }

/** Clock and visibility, so tests can run the poll without a browser. */
export interface HeadPollEnv {
  fetchHead: (path: string, signal: AbortSignal) => Promise<HeadResult>
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  visibility: () => 'visible' | 'hidden'
  /** Subscribe to visibility transitions. Returns the unsubscribe. */
  onVisibility: (callback: () => void) => () => void
}

/** One directory's subscribers. `path` is the first subscriber's spelling;
 * later aliases share it. */
interface Bucket {
  path: string
  listeners: Set<(branch: string) => void>
  request?: AbortController
}

export interface HeadPoll {
  subscribe: (path: string, listener: (branch: string) => void) => () => void
}

/** Separators, a trailing slash, and (for a drive-letter path) letter case. */
function pollKey(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(slashed) ? slashed.toLowerCase() : slashed
}

/** A poll bound to `env`. Production uses one shared instance. */
export function createHeadPoll(env: HeadPollEnv): HeadPoll {
  const buckets = new Map<string, Bucket>()
  let timer: unknown
  let unsubscribeVisibility: (() => void) | undefined

  const stop = (): void => {
    if (timer === undefined) return
    env.clearInterval(timer)
    timer = undefined
  }

  const start = (): void => {
    if (timer !== undefined || env.visibility() !== 'visible' || buckets.size === 0) return
    timer = env.setInterval(tick, HEAD_POLL_MS)
  }

  const onVisibility = (): void => {
    if (env.visibility() === 'visible') start()
    else {
      stop()
      for (const bucket of buckets.values()) bucket.request?.abort()
    }
  }

  function tick(): void {
    if (env.visibility() !== 'visible') {
      stop()
      return
    }
    for (const bucket of buckets.values()) {
      if (bucket.request === undefined) void readBucket(bucket)
    }
  }

  async function readBucket(bucket: Bucket): Promise<void> {
    const controller = new AbortController()
    bucket.request = controller
    const timeout = env.setTimeout(() => { controller.abort() }, HEAD_POLL_TIMEOUT_MS)
    // Also release the bucket if a fetch seam ignores cancellation. Any late
    // result then loses this race and cannot notify a new subscription.
    const cancelled = new Promise<undefined>((resolve) => {
      controller.signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
    })
    try {
      const result = await Promise.race([env.fetchHead(bucket.path, controller.signal), cancelled])
      if (controller.signal.aborted || env.visibility() !== 'visible') return
      if (result === undefined || !result.ok || !result.repo || !('currentBranch' in result)) return
      if (result.currentBranch === '') return
      for (const listener of [...bucket.listeners]) {
        if (!bucket.listeners.has(listener)) continue
        try {
          listener(result.currentBranch)
        } catch {
          // One label's callback must not sink the rest of the tick.
        }
      }
    } catch {
      // Read failures leave the label in place; the next interval retries.
    } finally {
      env.clearTimeout(timeout)
      delete bucket.request
    }
  }

  return {
    subscribe(path, listener) {
      const key = pollKey(path)
      let bucket = buckets.get(key)
      if (bucket === undefined) {
        bucket = { path, listeners: new Set() }
        buckets.set(key, bucket)
      }
      bucket.listeners.add(listener)
      if (unsubscribeVisibility === undefined) unsubscribeVisibility = env.onVisibility(onVisibility)
      start()
      return () => {
        const current = buckets.get(key)
        if (current !== bucket) return
        current.listeners.delete(listener)
        if (current.listeners.size > 0) return
        buckets.delete(key)
        current.request?.abort()
        if (buckets.size > 0) return
        stop()
        unsubscribeVisibility?.()
        unsubscribeVisibility = undefined
      }
    },
  }
}

let shared: HeadPoll | undefined

/** Join the page-wide HEAD poll. The unsubscribe drops this listener only. */
export function subscribeCheckedOutBranch(path: string, listener: (branch: string) => void): () => void {
  shared ??= createHeadPoll(browserEnv())
  return shared.subscribe(path, listener)
}

function browserEnv(): HeadPollEnv {
  return {
    fetchHead,
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (id) => { window.clearInterval(id as number) },
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => { window.clearTimeout(id as number) },
    visibility: () => document.visibilityState === 'visible' ? 'visible' : 'hidden',
    onVisibility: (callback) => {
      document.addEventListener('visibilitychange', callback)
      return () => { document.removeEventListener('visibilitychange', callback) }
    },
  }
}
