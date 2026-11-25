/**
 * Application-scoped toast queue for git-worktree notifications.
 *
 * A worktree creation hops to a new session (which unmounts the originating
 * BranchChipDock) before its warnings (`fetchWarning`, `excludeWarning`,
 * `copyWarning`) and lazy auto-prune summary settle. Keeping the queue at
 * module scope and rendering it from `shell.overlay` ensures toasts survive
 * session switches and modal closes without overwriting one another.
 *
 * @module git-worktree/client/toast-bus
 */

/** One queued toast banner. */
export interface QueuedToast {
  readonly seq: number
  readonly text: string
  readonly tone?: 'success'
}

type Listener = () => void

let nextSeq = 0
let queue: readonly QueuedToast[] = []
let mountedHosts = 0
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Push a toast message onto the global sequential queue.
 * @param text - localized message to display.
 * @param tone - optional `'success'` tone for affirmative confirmations.
 */
export function emitToast(text: string, tone?: 'success'): void {
  nextSeq += 1
  const entry: QueuedToast = tone === undefined ? { seq: nextSeq, text } : { seq: nextSeq, text, tone }
  queue = [...queue, entry]
  notify()
}

/** Dismiss the currently visible head toast (if its seq still matches). */
export function shiftToast(seq: number): void {
  if (queue[0]?.seq !== seq) return
  queue = queue.slice(1)
  notify()
}

/** Current head toast waiting to be rendered, or undefined when empty. */
export function peekToast(): QueuedToast | undefined {
  return queue[0]
}

/** Subscribe to queue changes. */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Register one mounted `shell.overlay` host and return its unregister disposer. */
export function registerToastHost(): () => void {
  mountedHosts += 1
  return () => {
    mountedHosts = Math.max(0, mountedHosts - 1)
  }
}

/** Whether a `shell.overlay` host is currently mounted to drain the queue. */
export function hasGlobalToastHost(): boolean {
  return mountedHosts > 0
}

/** Reset the queue and counters (tests only). */
export function resetToastsForTest(): void {
  nextSeq = 0
  queue = []
  mountedHosts = 0
  listeners.clear()
}
