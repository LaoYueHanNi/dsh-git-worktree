import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { BranchChipDock } from '../src/client/BranchChip.tsx'
import { HEAD_POLL_MS } from '../src/client/head-poll.ts'
import { fetchHead, fetchStatus } from '../src/client/api.ts'

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
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button', IconBranchOutlineRegular: 'svg', Toast: 'span' }))
vi.mock('../src/client/BranchMenu.tsx', () => ({ BranchMenu: 'div' }))

const facts = (branch: string) => ({
  ok: true as const, repo: true as const, main: true, currentBranch: branch,
  branches: [], worktrees: [], repoRoot: 'C:/repo', repoName: 'repo', rootDir: 'C:/worktrees',
})
let cwd = 'C:/repo'
const props = {
  sessionId: 's',
  useSessions: (select: (state: unknown) => unknown) => select({ byId: { s: { cwd } } }),
  useSession: (select: (state: unknown) => unknown) => select({ blank: true }),
  t: (key: string) => key,
} as unknown as Parameters<typeof BranchChipDock>[0]
const render = () => BranchChipDock(props)

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
})
