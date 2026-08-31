/**
 * The add-workspace pick flow's orchestration core, isolated from React so
 * the dialog's EDGE-TRIGGERED start and its in-flight invalidation are
 * unit-testable without a DOM: the component syncs the open flag and
 * refreshes the hooks each render, and neither re-render nor unmount can
 * re-launch the OS directory chooser behind the user's back.
 *
 * @module git-worktree/client/pick-flow
 */

/** What a run needs from its host; refreshed on every render via {@link PickFlowController.attach}. */
export interface PickFlowHooks {
  /** Opens the OS directory chooser; `null`/empty means the user cancelled. */
  readonly pickDirectory: () => Promise<string | null>
  /** Registers the chosen directory as a workspace. */
  readonly createWorkspace: (input: { path: string }) => Promise<{ workspaceId: string }>
  /** The chosen directory became a workspace. */
  readonly onPicked: (workspaceId: string) => void
  /** The user dismissed the chooser; the dialog simply closes. */
  readonly onCancelled: () => void
  /** pick/create rejected; the caller surfaces the message (and closes). */
  readonly onFailed: (message: string) => void
}

/**
 * Edge-triggered controller for one add-workspace flow.
 *
 * `sync(open)` mirrors the dialog's open flag: only a RISING edge (closed →
 * open) starts a pick — re-syncing `true` while a run is live is a no-op, so
 * the parent's re-renders (fresh inline callbacks and all) can never
 * re-launch the chooser or drop a finished pick the way an effect keyed on
 * unstable function deps would. A falling edge invalidates any in-flight
 * run: its eventual result is discarded without a callback. `kill()` is the
 * permanent teardown — nothing fires after it.
 */
export class PickFlowController {
  private hooks: PickFlowHooks | undefined
  private started = false
  private epoch = 0

  /** Refresh the callbacks to the latest render's closures; never restarts a run. */
  attach(hooks: PickFlowHooks): void {
    this.hooks = hooks
  }

  /** Sync with the dialog's open flag (see the class doc for the edge semantics). */
  sync(open: boolean): void {
    if (open) {
      if (this.started) return
      this.started = true
      this.epoch += 1
      void this.run(this.epoch)
      return
    }
    // Closing (or staying closed) invalidates whatever is in flight.
    this.epoch += 1
    this.started = false
  }

  /** Permanent teardown (unmount): no callback fires afterwards. */
  kill(): void {
    this.epoch += 1
    this.started = false
  }

  private async run(token: number): Promise<void> {
    const hooks = this.hooks
    if (hooks === undefined) return
    let path: string | null
    try {
      path = await hooks.pickDirectory()
    } catch (reason) {
      if (token === this.epoch) hooks.onFailed(messageOf(reason))
      return
    }
    if (token !== this.epoch) return
    if (path === null || path === '') {
      hooks.onCancelled()
      return
    }
    let workspace: { workspaceId: string }
    try {
      workspace = await hooks.createWorkspace({ path })
    } catch (reason) {
      if (token === this.epoch) hooks.onFailed(messageOf(reason))
      return
    }
    if (token !== this.epoch) return
    hooks.onPicked(workspace.workspaceId)
  }
}

/** Error text for a rejection of any shape. */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
