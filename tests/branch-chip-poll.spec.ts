import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { BranchChipDock } from '../src/client/BranchChip.tsx'
import { HEAD_POLL_MS } from '../src/client/head-poll.ts'
import { fetchHead, fetchStatus, requestFetch, requestPush, requestUpdate, type LiveCall } from '../src/client/api.ts'
import { cancelSyncJob } from '../src/client/sync-job.ts'
import type { PushDialogProps } from '../src/client/PushDialog.tsx'
import type { BranchMenuProps } from '../src/client/BranchMenu.tsx'
import type { SyncProgressProps } from '../src/client/SyncProgress.tsx'

/** Run the dock's actual hooks/effects without a DOM renderer. Child elements
 * are never mounted; these tests exercise status, subscriptions and timers. */
const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | undefined }
  let slots: Slot[] = []
  let cursor = 0
  let dirty = true
  let effects: Array<() => void> = []
  let output: unknown
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  function memo<T>(fn: () => T, deps: readonly unknown[]): T {
    const index = cursor++
    if (!slots[index] || !same(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }
    return slots[index]?.value as T
  }
  function effect(fn: () => (() => void) | void, deps?: readonly unknown[]): void {
    const index = cursor++
    const previous = slots[index]
    if (previous && same(previous.deps, deps)) return
    slots[index] = { deps }
    effects.push(() => {
      previous?.cleanup?.()
      slots[index]!.cleanup = fn() ?? undefined
    })
  }
  return {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? (initial as () => T)() : initial }
      return [slots[index]!.value as T, (next: T | ((previous: T) => T)) => {
        const value = typeof next === 'function' ? (next as (previous: T) => T)(slots[index]!.value as T) : next
        if (!Object.is(value, slots[index]!.value)) {
          slots[index]!.value = value
          dirty = true
        }
      }] as const
    },
    useRef<T>(initial: T) {
      const index = cursor++
      slots[index] ??= { value: { current: initial } }
      return slots[index]!.value as { current: T }
    },
    useMemo: memo,
    useCallback: <T,>(fn: T, deps: readonly unknown[]) => memo(() => fn, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    rerender() { dirty = true },
    async flush(render: () => unknown) {
      for (let i = 0; i < 12; i++) {
        if (dirty) {
          dirty = false
          cursor = 0
          output = render()
          const pending = effects
          effects = []
          pending.forEach(fn => fn())
        }
        await Promise.resolve()
      }
      if (dirty) throw new Error('dock did not settle')
      return output
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.()
      slots = []
      effects = []
      cursor = 0
      dirty = true
      output = undefined
    },
  }
})

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(), ...hooks }))
vi.mock('../src/client/api.ts', () => ({
  fetchStatus: vi.fn(), fetchHead: vi.fn(),
  requestCreateBranch: vi.fn(), requestDeleteBranch: vi.fn(), requestFetch: vi.fn(),
  requestInspectWorktree: vi.fn(), requestRenameBranch: vi.fn(), requestSwitch: vi.fn(),
  requestUpdate: vi.fn(), requestWorktree: vi.fn(), requestWorktreeCutout: vi.fn(),
  requestPush: vi.fn(), requestPushPlan: vi.fn(),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button', IconBranchOutlineRegular: 'svg', MenuItemButton: 'button', Toast: 'span' }))
vi.mock('../src/client/BranchMenu.tsx', () => ({ BranchMenu: 'div' }))
vi.mock('../src/client/PushDialog.tsx', () => ({ PushDialog: 'push-dialog' }))
vi.mock('../src/client/SyncProgress.tsx', () => ({ SyncProgress: 'sync-progress' }))

const facts = (branch: string) => ({
  ok: true as const, repo: true as const, main: true, currentBranch: branch,
  branches: [], worktrees: [], repoRoot: 'C:/repo', repoName: 'repo', rootDir: 'C:/worktrees',
})
let cwd = 'C:/repo'
const props = {
  sessionId: 's',
  useSessions: (select: (state: unknown) => unknown) => select({ byId: { s: { cwd } } }),
  useSession: (select: (state: unknown) => unknown) => select({ blank: true }),
  openGraphByDefault: () => false,
  t: (key: string) => key,
} as unknown as Parameters<typeof BranchChipDock>[0]
const render = () => BranchChipDock(props)
function menu(output: unknown): BranchMenuProps {
  const root = output as React.ReactElement<{ children: React.ReactElement[] }>
  return root.props.children.find(child => child?.props?.onPush !== undefined)!.props
}

describe('BranchChipDock poll recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    cwd = 'C:/repo'
    // The server test config compiles JSX using the classic React runtime.
    vi.stubGlobal('React', React)
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      setInterval, clearInterval, setTimeout, clearTimeout,
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    vi.mocked(fetchStatus).mockReset().mockResolvedValue(facts('master'))
    vi.mocked(fetchHead).mockReset().mockResolvedValue({ ok: true, repo: true, currentBranch: 'test-1' })
    vi.mocked(requestPush).mockReset().mockResolvedValue({ ok: true, branch: 'feature/x', remote: 'origin', target: 'feature/x' })
    vi.mocked(requestFetch).mockReset()
    vi.mocked(requestUpdate).mockReset()
  })

  afterEach(() => {
    hooks.unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the label and polling after a failed refresh, then updates on the next tick', async () => {
    expect(await hooks.flush(render)).not.toBeNull()
    vi.mocked(fetchStatus)
      .mockResolvedValueOnce({ ok: false, error: 'HTTP 500' })
      .mockResolvedValue(facts('test-1'))
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    const afterFailure = await hooks.flush(render)
    expect(afterFailure).not.toBeNull()
    expect(JSON.stringify(afterFailure)).toContain('master')
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    const recovered = await hooks.flush(render)
    expect(JSON.stringify(recovered)).toContain('test-1')
    expect(fetchHead).toHaveBeenCalledTimes(2)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    await hooks.flush(render)
    expect(fetchStatus).toHaveBeenCalledTimes(3) // Matching HEAD needs no full refresh.
  })

  it('clears the label and unsubscribes when a successful status says the repo is gone', async () => {
    await hooks.flush(render)
    vi.mocked(fetchStatus).mockResolvedValue({ ok: true, repo: false })
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(await hooks.flush(render)).toBeNull()
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS * 2)
    expect(fetchHead).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retain the previous repository label when the session directory changes', async () => {
    await hooks.flush(render)
    cwd = 'C:/other'
    vi.mocked(fetchStatus).mockResolvedValue({ ok: false, error: 'offline' })
    // A prop update renders even when no hook state changed.
    hooks.rerender()
    expect(await hooks.flush(render)).toBeNull()
    expect(fetchStatus).toHaveBeenLastCalledWith('C:/other')
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(fetchHead).not.toHaveBeenCalled()
  })

  function dialog(output: unknown): PushDialogProps | undefined {
    const root = output as React.ReactElement<{ children: React.ReactElement[] }>
    return root.props.children.find(child => child?.type === 'push-dialog')?.props
  }

  it('opens a dedicated push window without executing a push; cancel closes it', async () => {
    menu(await hooks.flush(render)).onPush('feature/x')
    const output = await hooks.flush(render)
    expect(menu(output).open).toBe(false)
    expect(menu(output).confirm).toBeNull()
    expect(dialog(output)?.branch).toBe('feature/x')
    expect(requestPush).not.toHaveBeenCalled()
    dialog(output)?.onClose()
    expect(dialog(await hooks.flush(render))).toBeUndefined()
  })

  it('opens the push window fresh from the menu: no failed push to resume', async () => {
    menu(await hooks.flush(render)).onPush('feature/x')
    expect(dialog(await hooks.flush(render))).not.toHaveProperty('resume')
  })

  it('passes already-loaded tracking facts for the chosen branch without refreshing status', async () => {
    const branchInfo = { kind: 'local' as const, name: 'feature/x', upstream: 'origin/feature/x', ahead: 2 }
    vi.mocked(fetchStatus).mockResolvedValue({ ...facts('master'), branches: [branchInfo] })
    menu(await hooks.flush(render)).onPush('feature/x')
    const output = await hooks.flush(render)
    expect(dialog(output)?.branchInfo).toBe(branchInfo)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(requestPush).not.toHaveBeenCalled()
  })

  it('discards the push window when the session changes repositories', async () => {
    menu(await hooks.flush(render)).onPush('feature/x')
    expect(dialog(await hooks.flush(render))).toBeDefined()
    cwd = 'C:/other'
    hooks.rerender()
    expect(dialog(await hooks.flush(render))).toBeUndefined()
    expect(requestPush).not.toHaveBeenCalled()
  })

  function card(output: unknown): SyncProgressProps | undefined {
    const root = output as React.ReactElement<{ children: React.ReactElement[] }>
    return root.props.children.find(child => child?.type === 'sync-progress')?.props
  }
  /** The mocked Toast is a bare `span` like the chip's own wrapper: tell them apart by `text`. */
  function toastProps(output: unknown): { text?: string; onDone?: () => void } | undefined {
    const root = output as React.ReactElement<{ children: React.ReactElement[] }>
    return root.props.children.find(child => child?.type === 'span' && (child.props as { text?: string }).text !== undefined)?.props as { text?: string; onDone?: () => void } | undefined
  }
  function toast(output: unknown): string | undefined {
    return toastProps(output)?.text
  }
  /** The toast timed out: the queue shows the next one. */
  function dismiss(output: unknown): void {
    toastProps(output)?.onDone?.()
  }
  /** A streamed call the test finishes by hand; an abort resolves it as a failed call. */
  // The first argument is the directory for fetch/update, the body for push.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function pendingCall<T extends object>(mock: { mockImplementation: (impl: (first: any, live?: LiveCall) => Promise<unknown>) => unknown }) {
    const call: { live: LiveCall; finish: (value: T | { ok: false; error: string }) => void } = { live: {}, finish: () => undefined }
    mock.mockImplementation((_first, live) => new Promise((resolve) => {
      call.live = live ?? {}
      call.finish = resolve as typeof call.finish
      live?.signal?.addEventListener('abort', () => { resolve({ ok: false, error: 'The operation was aborted' }) }, { once: true })
    }))
    return call
  }

  /** Let a whole async chain (abort → settle → refresh → toast) play out: one
   * flush only grants a dozen microtask turns, which a chain this long can outrun. */
  async function settle(): Promise<unknown> {
    await hooks.flush(render)
    await hooks.flush(render)
    return hooks.flush(render)
  }

  describe('fetch and update as floating jobs', () => {
    it('shows a card with git’s live progress, keeps the menu usable to close, and toasts when it ends', async () => {
      const call = pendingCall<{ ok: true; remote: string }>(vi.mocked(requestFetch))
      menu(await hooks.flush(render)).onFetch()
      let output = await hooks.flush(render)
      expect(card(output)?.job).toMatchObject({ kind: 'fetch', cwd: 'C:/repo', stage: 'fetch' })
      expect(card(output)?.branch).toBe('master')
      // The other git actions are held off while it runs; only the running arrow pulses.
      expect(menu(output)).toMatchObject({ busy: true, fetchBusy: true, updateBusy: false })
      call.live.onEvent?.({ type: 'progress', text: 'Receiving objects:  40% (2/5)', percent: 40 })
      output = await hooks.flush(render)
      expect(card(output)?.job).toMatchObject({ text: 'Receiving objects:  40% (2/5)', percent: 40 })
      call.finish({ ok: true, remote: 'all' })
      output = await settle()
      expect(card(output)).toBeUndefined()
      expect(menu(output)).toMatchObject({ busy: false, fetchBusy: false })
      expect(toast(output)).toBe('fetchDone')
      expect(fetchStatus).toHaveBeenCalledTimes(2)
    })

    it('cancels from the card: the transfer is aborted, the list refreshed, and a cancelled notice shown', async () => {
      const call = pendingCall<{ ok: true; remote: string }>(vi.mocked(requestFetch))
      menu(await hooks.flush(render)).onFetch()
      const output = await hooks.flush(render)
      call.live.onEvent?.({ type: 'progress', text: 'Receiving objects:  10% (1/10)', percent: 10 })
      card(output)!.onCancel()
      const after = await settle()
      expect(call.live.signal?.aborted).toBe(true)
      expect(card(after)).toBeUndefined()
      expect(toast(after)).toBe('fetchCancelled')
      expect(fetchStatus).toHaveBeenCalledTimes(2)
    })

    it('reports an update fast-forward, an up-to-date branch and a failure differently', async () => {
      const call = pendingCall<{ ok: true; branch: string; updated: boolean }>(vi.mocked(requestUpdate))
      menu(await hooks.flush(render)).onUpdate()
      expect(menu(await hooks.flush(render))).toMatchObject({ busy: true, updateBusy: true, fetchBusy: false })
      call.finish({ ok: true, branch: 'master', updated: true })
      const moved = await settle()
      expect(toast(moved)).toBe('updateDone')
      dismiss(moved)

      menu(await settle()).onUpdate()
      await hooks.flush(render)
      call.finish({ ok: true, branch: 'master', updated: false })
      const same = await settle()
      expect(toast(same)).toBe('updateUpToDate')
      dismiss(same)

      menu(await settle()).onUpdate()
      await hooks.flush(render)
      const statusCalls = vi.mocked(fetchStatus).mock.calls.length
      call.finish({ ok: false, error: 'fatal: early EOF' })
      const failed = await settle()
      expect(toast(failed)).toBe('errorGeneric')
      expect(card(failed)).toBeUndefined()
      dismiss(failed)

      menu(await settle()).onUpdate()
      await hooks.flush(render)
      call.finish({ ok: false, error: 'fatal: Not possible to fast-forward, aborting.\nhint: Diverging branches can\'t be fast-forwarded' })
      expect(toast(await settle())).toBe('updateFailDiverged')
      // A failed run changed nothing worth re-reading.
      expect(vi.mocked(fetchStatus).mock.calls.length).toBe(statusCalls)
      expect(vi.mocked(requestUpdate)).toHaveBeenCalledWith('C:/repo', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    })

    it('does not start a second sync, and keeps push and the other actions out, while one runs', async () => {
      const call = pendingCall<{ ok: true; branch: string; updated: boolean }>(vi.mocked(requestUpdate))
      menu(await hooks.flush(render)).onUpdate()
      const running = menu(await hooks.flush(render))
      running.onFetch()
      running.onUpdate()
      running.onPush('feature/x')
      const output = await hooks.flush(render)
      expect(requestFetch).not.toHaveBeenCalled()
      expect(requestUpdate).toHaveBeenCalledTimes(1)
      expect(dialog(output)).toBeUndefined()
      call.finish({ ok: true, branch: 'master', updated: false })
      await hooks.flush(render)
    })

    it('still shows the running job after the dock is remounted, and still blocks a second one', async () => {
      pendingCall<{ ok: true; remote: string }>(vi.mocked(requestFetch))
      menu(await hooks.flush(render)).onFetch()
      await hooks.flush(render)
      // Switching sessions away and back: a brand-new dock instance.
      hooks.unmount()
      const output = await hooks.flush(render)
      expect(card(output)?.job).toMatchObject({ kind: 'fetch', cwd: 'C:/repo' })
      expect(menu(output)).toMatchObject({ busy: true, fetchBusy: true })
      menu(output).onUpdate()
      await hooks.flush(render)
      expect(requestUpdate).not.toHaveBeenCalled()
      // Wind the run down inside the test, while the dock is still mounted.
      cancelSyncJob('C:/repo')
      await settle()
    })

    it('shows the card only for the directory that is syncing', async () => {
      pendingCall<{ ok: true; remote: string }>(vi.mocked(requestFetch))
      menu(await hooks.flush(render)).onFetch()
      expect(card(await hooks.flush(render))).toBeDefined()
      cwd = 'C:/other'
      vi.mocked(fetchStatus).mockResolvedValue(facts('main'))
      hooks.rerender()
      const other = await hooks.flush(render)
      expect(card(other)).toBeUndefined()
      expect(menu(other)).toMatchObject({ busy: false, fetchBusy: false })
      cancelSyncJob('C:/repo')
      await settle()
    })
  })

  describe('push as a floating job', () => {
    type Pushed = { ok: true; branch: string; remote: string; target: string }
    const options = { remote: 'github', target: 'review/x', tags: 'follow' as const, force: true, sourceOid: 'a'.repeat(40), expectedTarget: 'b'.repeat(40) }

    /** Open the push window of `feature/x` and press Push in it. */
    async function pushFromWindow(): Promise<{ staged: PushDialogProps; call: ReturnType<typeof pendingCall<Pushed>>; handedOver: string | undefined }> {
      const call = pendingCall<Pushed>(vi.mocked(requestPush))
      menu(await hooks.flush(render)).onPush('feature/x')
      const staged = dialog(await hooks.flush(render))!
      return { staged, call, handedOver: await staged.onPush(options) }
    }

    it('closes the window at once, runs the push behind the card with git’s progress, and toasts when it is done', async () => {
      const { staged, call, handedOver } = await pushFromWindow()
      // Taken, not awaited to the end: the window is already gone.
      expect(handedOver).toBeUndefined()
      // One push at a time: a second press (the window is still on the first
      // one's screen for a tick) is refused, not queued.
      expect(await staged.onPush(options)).toBe('pushBusy')
      let output = await hooks.flush(render)
      expect(dialog(output)).toBeUndefined()
      expect(card(output)?.job).toMatchObject({ kind: 'push', cwd: 'C:/repo', branch: 'feature/x', remote: 'github' })
      expect(menu(output)).toMatchObject({ busy: true, fetchBusy: false, updateBusy: false })
      expect(requestPush).toHaveBeenCalledTimes(1)
      expect(requestPush).toHaveBeenCalledWith({ repoPath: 'C:/repo', branch: 'feature/x', ...options }, expect.objectContaining({ signal: expect.any(AbortSignal) }))

      call.live.onEvent?.({ type: 'progress', text: 'Writing objects:  40% (2/5), 1.00 MiB | 1.00 MiB/s', percent: 40 })
      output = await hooks.flush(render)
      // The remote is known from the start and kept by lines that do not name it.
      expect(card(output)?.job).toMatchObject({ text: 'Writing objects:  40% (2/5), 1.00 MiB | 1.00 MiB/s', percent: 40, remote: 'github' })

      call.finish({ ok: true, branch: 'feature/x', remote: 'github', target: 'review/x' })
      output = await settle()
      expect(card(output)).toBeUndefined()
      expect(dialog(output)).toBeUndefined()
      expect(toast(output)).toBe('pushDone')
      expect(menu(output)).toMatchObject({ busy: false })
      // The ahead/behind marks are re-read once.
      expect(fetchStatus).toHaveBeenCalledTimes(2)
    })

    it('puts the window back with git’s reason and the same choices when the push fails, ready for a retry', async () => {
      const { call } = await pushFromWindow()
      call.finish({ ok: false, error: '! refs/heads/feature/x:refs/heads/review/x [rejected] (fetch first)' })
      const output = await settle()
      expect(card(output)).toBeUndefined()
      // No toast: the reason belongs in the window, next to what was chosen.
      expect(toast(output)).toBeUndefined()
      expect(dialog(output)).toMatchObject({
        branch: 'feature/x',
        resume: { branch: 'feature/x', remote: 'github', target: 'review/x', tags: 'follow', error: '! refs/heads/feature/x:refs/heads/review/x [rejected] (fetch first)' },
      })
      // The window is usable again, and pushing from it starts a fresh job.
      const reopened = dialog(output)!
      expect(reopened.busy).toBe(false)
      const retry = pendingCall<Pushed>(vi.mocked(requestPush))
      expect(await reopened.onPush(options)).toBeUndefined()
      expect(requestPush).toHaveBeenCalledTimes(2)
      retry.finish({ ok: true, branch: 'feature/x', remote: 'github', target: 'review/x' })
      const done = await settle()
      expect(dialog(done)).toBeUndefined()
      expect(toast(done)).toBe('pushDone')
    })

    it('closing the returned window forgets the failure: the next push window opens fresh', async () => {
      const { call } = await pushFromWindow()
      call.finish({ ok: false, error: 'boom' })
      const output = await settle()
      dialog(output)!.onClose()
      expect(dialog(await hooks.flush(render))).toBeUndefined()
      menu(await hooks.flush(render)).onPush('feature/x')
      expect(dialog(await hooks.flush(render))).not.toHaveProperty('resume')
    })

    it('cancels from the card: the push is aborted, no window comes back, and a cancelled notice is shown', async () => {
      const { call } = await pushFromWindow()
      card(await hooks.flush(render))!.onCancel()
      const after = await settle()
      expect(call.live.signal?.aborted).toBe(true)
      expect(card(after)).toBeUndefined()
      expect(dialog(after)).toBeUndefined()
      expect(toast(after)).toBe('pushCancelled')
    })

    it('keeps the failure of a push the user left behind, and shows the window when they return', async () => {
      const { call } = await pushFromWindow()
      // The user moves to another session while the push runs …
      cwd = 'C:/other'
      vi.mocked(fetchStatus).mockResolvedValue(facts('main'))
      hooks.rerender()
      const away = await hooks.flush(render)
      expect(card(away)).toBeUndefined()
      // … it fails there, with no dock on that directory to say so …
      call.finish({ ok: false, error: 'remote: Permission to x denied' })
      const meanwhile = await settle()
      expect(dialog(meanwhile)).toBeUndefined()
      expect(toast(meanwhile)).toBeUndefined()
      // … and the reason is waiting when they come back.
      cwd = 'C:/repo'
      vi.mocked(fetchStatus).mockResolvedValue(facts('master'))
      hooks.rerender()
      const back = await settle()
      expect(dialog(back)).toMatchObject({ branch: 'feature/x', resume: { remote: 'github', error: 'remote: Permission to x denied' } })
    })
  })
})
