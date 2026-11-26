import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { closeWorktreeAction, getWorktreeAction } from '../src/client/action-bus.ts'
import { requestPrCheckout, requestPrContext, requestPrResolve } from '../src/client/api.ts'
import { CheckoutPrModal, filterPrCandidates, looksLikePrTarget, type CheckoutPrModalProps } from '../src/client/CheckoutPrModal.tsx'
import { formatPrError } from '../src/client/pr-error.ts'
import { ForgeCardCheckoutButton, ForgeDiffToolbarCheckoutButton } from '../src/client/ForgeIntegration.tsx'
import { SidebarWorktreeHover, SidebarWorktreeTrailing } from '../src/client/SidebarWorktreeBadge.tsx'
import { createWorkspaceGitCache } from '../src/client/workspace-git-cache.ts'
import type { PrCandidateItem, PrContextResult, PrResolveResult } from '../src/wire.ts'

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
    useSyncExternalStore<T>(_sub: unknown, getSnapshot: () => T) {
      return getSnapshot()
    },
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

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks }))
vi.mock('../src/client/api.ts', () => ({
  requestPrContext: vi.fn(),
  requestPrResolve: vi.fn(),
  requestPrCheckout: vi.fn(),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: 'button',
  Modal: 'modal',
  Tag: 'tag',
  Tooltip: 'tooltip',
  MenuItemButton: 'menuitem',
  IconBranchOutlineRegular: 'svg',
  writeClipboard: vi.fn().mockResolvedValue(true),
}))

const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as PropsLocale<'git-worktree'>['t']

function nodes(output: unknown): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement(output)) return []
  const element = output as React.ReactElement<Record<string, unknown>>
  return [
    element,
    ...React.Children.toArray(element.props.children as React.ReactNode).flatMap(nodes),
    ...nodes(element.props.footer),
  ]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('React', React)
  vi.mocked(requestPrContext).mockReset()
  vi.mocked(requestPrResolve).mockReset()
  vi.mocked(requestPrCheckout).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  hooks.unmount()
  vi.unstubAllGlobals()
  closeWorktreeAction()
})

describe('filterPrCandidates', () => {
  const sample: PrCandidateItem[] = [
    {
      provider: 'github',
      host: 'github.com',
      owner: 'org',
      repo: 'app',
      number: 412,
      url: 'https://github.com/org/app/pull/412',
      title: 'Add fork PR flow',
      author: 'alice',
      draft: false,
      checksRollup: 'success',
      reviewDecision: 'review-required',
      filter: 'review-requested',
      updatedAt: '2026-11-26T00:00:00Z',
      remote: 'origin',
      localBranch: 'github-pr-412',
    },
    {
      provider: 'github',
      host: 'github.com',
      owner: 'org',
      repo: 'app',
      number: 398,
      url: 'https://github.com/org/app/pull/398',
      title: 'Refactor menus',
      author: 'bob',
      draft: true,
      checksRollup: 'pending',
      reviewDecision: 'none',
      filter: 'authored',
      updatedAt: '2026-11-25T00:00:00Z',
      remote: 'origin',
      localBranch: 'github-pr-398',
    },
  ]

  it('filters by active tab when query is empty and searches across tabs when query is given', () => {
    expect(filterPrCandidates(sample, 'review-requested', '').map(i => i.number)).toEqual([412])
    expect(filterPrCandidates(sample, 'authored', '').map(i => i.number)).toEqual([398])
    expect(filterPrCandidates(sample, 'review-requested', '#398').map(i => i.number)).toEqual([398])
    expect(filterPrCandidates(sample, 'authored', 'alice').map(i => i.number)).toEqual([412])
  })
})

describe('CheckoutPrModal', () => {
  it('keeps all candidates visible on open & click, reuses blank session, and triggers checkout + auto-track', async () => {
    vi.mocked(requestPrContext).mockResolvedValue({
      ok: true,
      repoRoot: '/repo',
      repoName: 'repo',
      remotes: [{ name: 'origin', url: 'https://github.com/org/app.git', provider: 'github', host: 'github.com', owner: 'org', repo: 'app' }],
      defaultRemote: 'origin',
      forge: { available: true, readiness: 'ready' },
      candidates: [
        {
          provider: 'github',
          host: 'github.com',
          owner: 'org',
          repo: 'app',
          number: 412,
          url: 'https://github.com/org/app/pull/412',
          title: 'Add fork PR flow',
          author: 'alice',
          draft: false,
          checksRollup: 'success',
          reviewDecision: 'review-required',
          filter: 'review-requested',
          updatedAt: '2026-11-26T00:00:00Z',
          remote: 'origin',
          localBranch: 'github-pr-412',
        },
        {
          provider: 'github',
          host: 'github.com',
          owner: 'org',
          repo: 'app',
          number: 415,
          url: 'https://github.com/org/app/pull/415',
          title: 'Second open PR',
          author: 'bob',
          draft: true,
          checksRollup: 'pending',
          reviewDecision: 'none',
          filter: 'review-requested',
          updatedAt: '2026-11-25T00:00:00Z',
          remote: 'origin',
          localBranch: 'github-pr-415',
        },
      ],
    })
    vi.mocked(requestPrResolve).mockResolvedValue({
      ok: true,
      provider: 'github',
      number: 412,
      remote: 'origin',
      refSpec: 'refs/pull/412/head',
      localBranch: 'github-pr-412',
      targetPath: '/repo/.dsh/gitworktree/github-pr-412',
      canonicalUrl: 'https://github.com/org/app/pull/412',
    })
    vi.mocked(requestPrCheckout).mockResolvedValue({
      ok: true,
      path: '/repo/.dsh/gitworktree/github-pr-412',
      created: true,
      branch: 'github-pr-412',
      provider: 'github',
      number: 412,
      canonicalUrl: 'https://github.com/org/app/pull/412',
    })

    const adoptWorktree = vi.fn().mockResolvedValue(undefined)
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const props: CheckoutPrModalProps = {
      repoPath: '/repo',
      repoName: 'repo',
      reuseBlankSessionId: 'blank-s1',
      forgeTrackAvailable: true,
      adoptWorktree,
      onCreated,
      onClose,
      t,
    }

    let tree = await hooks.flush(() => CheckoutPrModal(props))
    // Both candidates remain visible on initial open (input is NOT prefilled with URL).
    let optionButtons = nodes(tree).filter(el => el.props.role === 'option')
    expect(optionButtons).toHaveLength(2)

    // Clicking candidate #412 resolves it WITHOUT filtering out candidate #415.
    ;(optionButtons[0]!.props.onClick as () => void)()
    await hooks.flush(() => CheckoutPrModal(props))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal(props))
    optionButtons = nodes(tree).filter(el => el.props.role === 'option')
    expect(optionButtons).toHaveLength(2)

    const all = nodes(tree)
    const submitBtn = all.find(el => el.type === 'button' && el.props.variant === 'primary')
    expect(submitBtn).toBeDefined()
    expect(submitBtn!.props.disabled).toBe(false)

    ;(submitBtn!.props.onClick as () => void)()
    await vi.advanceTimersByTimeAsync(0)
    await hooks.flush(() => CheckoutPrModal(props))

    expect(onCreated).toHaveBeenCalledWith('/repo/.dsh/gitworktree/github-pr-412')
    expect(adoptWorktree).toHaveBeenCalledWith('/repo/.dsh/gitworktree/github-pr-412', {
      reuseBlankSessionId: 'blank-s1',
      repoRoot: '/repo',
      trackPrUrl: 'https://github.com/org/app/pull/412',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('sends default github provider for unrecognized self-hosted remote when numeric ID is typed', async () => {
    vi.mocked(requestPrContext).mockResolvedValue({
      ok: true,
      repoRoot: '/repo',
      repoName: 'repo',
      remotes: [{ name: 'origin', url: 'ssh://git@git.corp.internal/team/app.git', provider: null, host: 'git.corp.internal', owner: 'team', repo: 'app' }],
      defaultRemote: 'origin',
      forge: { available: false, readiness: 'unsupported' },
      candidates: [],
    })
    vi.mocked(requestPrResolve).mockResolvedValue({
      ok: true,
      provider: 'github',
      number: 42,
      remote: 'origin',
      refSpec: 'refs/pull/42/head',
      localBranch: 'github-pr-42',
      targetPath: '/repo/.dsh/gitworktree/github-pr-42',
      canonicalUrl: 'https://git.corp.internal/team/app/pull/42',
    })

    const props: CheckoutPrModalProps = {
      repoPath: '/repo',
      repoName: 'repo',
      forgeTrackAvailable: false,
      adoptWorktree: vi.fn().mockResolvedValue(undefined),
      onCreated: vi.fn(),
      onClose: vi.fn(),
      t,
    }
    let tree = await hooks.flush(() => CheckoutPrModal(props))
    const input = nodes(tree).find(el => el.type === 'input' && el.props.type === 'text')!
    ;(input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '42' } })
    tree = await hooks.flush(() => CheckoutPrModal(props))
    await vi.advanceTimersByTimeAsync(200)
    await hooks.flush(() => CheckoutPrModal(props))

    expect(requestPrResolve).toHaveBeenCalledWith(
      { repoPath: '/repo', input: '42', remote: 'origin', provider: 'github' },
      expect.any(AbortSignal),
    )
  })

  it('shows diverged confirmation and sends reset on confirm', async () => {
    vi.mocked(requestPrContext).mockResolvedValue({
      ok: true,
      repoRoot: '/repo',
      repoName: 'repo',
      remotes: [{ name: 'origin', url: 'https://github.com/org/app.git', provider: 'github', host: 'github.com', owner: 'org', repo: 'app' }],
      defaultRemote: 'origin',
      forge: { available: false, readiness: 'unsupported' },
      candidates: [],
    })
    vi.mocked(requestPrResolve).mockResolvedValue({
      ok: true,
      provider: 'github',
      number: 42,
      remote: 'origin',
      refSpec: 'refs/pull/42/head',
      localBranch: 'github-pr-42',
      targetPath: '/repo/.dsh/gitworktree/github-pr-42',
      canonicalUrl: 'https://github.com/org/app/pull/42',
      existingWorktreePath: '/repo/.dsh/gitworktree/github-pr-42',
      existingBranch: true,
    })
    vi.mocked(requestPrCheckout)
      .mockResolvedValueOnce({ ok: false, error: 'diverged', code: 'worktree_diverged' })
      .mockResolvedValueOnce({
        ok: true,
        path: '/repo/.dsh/gitworktree/github-pr-42',
        created: false,
        updated: true,
        reset: true,
        branch: 'github-pr-42',
        provider: 'github',
        number: 42,
        canonicalUrl: 'https://github.com/org/app/pull/42',
      })

    const adoptWorktree = vi.fn().mockResolvedValue(undefined)
    const props: CheckoutPrModalProps = {
      repoPath: '/repo',
      repoName: 'repo',
      initialInput: '42',
      initialIfExists: 'update',
      forgeTrackAvailable: false,
      adoptWorktree,
      onCreated: vi.fn(),
      onClose: vi.fn(),
      t,
    }
    let tree = await hooks.flush(() => CheckoutPrModal(props))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal(props))

    const submitBtn = nodes(tree).find(el => el.type === 'button' && el.props.variant === 'primary')!
    ;(submitBtn.props.onClick as () => void)()
    await vi.advanceTimersByTimeAsync(0)
    tree = await hooks.flush(() => CheckoutPrModal(props))

    // Diverged confirmation offers reset button
    const resetBtn = nodes(tree).find(el => el.type === 'button' && el.props.children === 'prModal.divergedReset')
    expect(resetBtn).toBeDefined()
    ;(resetBtn!.props.onClick as () => void)()
    await vi.advanceTimersByTimeAsync(0)
    await hooks.flush(() => CheckoutPrModal(props))

    expect(requestPrCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ ifExists: 'reset' }),
      expect.any(Object),
    )
    expect(adoptWorktree).toHaveBeenCalled()
  })

  it('reloads candidates when switching remote and classifies target-like vs keyword input', async () => {
    expect(looksLikePrTarget('42')).toBe(true)
    expect(looksLikePrTarget('!17')).toBe(true)
    expect(looksLikePrTarget('https://github.com/a/b/pull/1')).toBe(true)
    expect(looksLikePrTarget('alice')).toBe(false)

    vi.mocked(requestPrContext).mockResolvedValue({
      ok: true,
      repoRoot: '/repo',
      repoName: 'repo',
      remotes: [
        { name: 'upstream', url: 'https://github.com/org/app.git', provider: 'github', host: 'github.com', owner: 'org', repo: 'app' },
        { name: 'origin', url: 'https://github.com/fork/app.git', provider: 'github', host: 'github.com', owner: 'fork', repo: 'app' },
      ],
      defaultRemote: 'upstream',
      forge: { available: true, readiness: 'ready' },
      candidates: [],
    })
    const props: CheckoutPrModalProps = {
      repoPath: '/repo',
      repoName: 'repo',
      forgeTrackAvailable: false,
      adoptWorktree: vi.fn().mockResolvedValue(undefined),
      onCreated: vi.fn(),
      onClose: vi.fn(),
      t,
    }
    const tree = await hooks.flush(() => CheckoutPrModal(props))
    const remoteSelect = nodes(tree).find(el => el.type === 'select')!
    ;(remoteSelect.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'origin' } })
    await hooks.flush(() => CheckoutPrModal(props))

    expect(requestPrContext).toHaveBeenLastCalledWith('/repo', expect.objectContaining({ remote: 'origin' }))
  })

  it('degrades cleanly when forge is unavailable and hides auto-track checkbox', async () => {
    vi.mocked(requestPrContext).mockResolvedValue({
      ok: true,
      repoRoot: '/repo',
      repoName: 'repo',
      remotes: [{ name: 'origin', url: 'https://github.com/org/app.git', provider: 'github', host: 'github.com', owner: 'org', repo: 'app' }],
      defaultRemote: 'origin',
      forge: { available: false, readiness: 'unsupported' },
      candidates: [],
    })

    const props: CheckoutPrModalProps = {
      repoPath: '/repo',
      repoName: 'repo',
      forgeTrackAvailable: false,
      adoptWorktree: vi.fn().mockResolvedValue(undefined),
      onCreated: vi.fn(),
      onClose: vi.fn(),
      t,
    }
    const tree = await hooks.flush(() => CheckoutPrModal(props))
    const all = nodes(tree)
    expect(all.some(el => el.type === 'input' && el.props.type === 'checkbox')).toBe(false)
    expect(all.some(el => el.props.role === 'tablist')).toBe(false)
  })
})

describe('Forge slot integration & sidebar badge coexistence', () => {
  it('opens prefilled CheckoutPrModal from Forge card and diff toolbar slots', async () => {
    const cache = createWorkspaceGitCache(async () => ({
      ok: true,
      facts: {
        '/code/app': { repoRoot: '/code/app', repoName: 'app', branch: 'main', main: true },
      },
    }))
    await cache.syncPaths(['/code/app'])

    const cardEl = await hooks.flush(() => ForgeCardCheckoutButton({
      sessionId: 's-1',
      url: 'https://github.com/org/app/pull/99',
      gitCache: cache,
      resolveSessionPath: () => '/code/app',
      t,
    }))
    expect(cardEl).not.toBeNull()
    const cardBtn = nodes(cardEl).find(n => n.type === 'button')!
    ;(cardBtn.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: () => {} })
    expect(getWorktreeAction()).toEqual({
      kind: 'checkout-pr',
      repoPath: '/code/app',
      repoName: 'app',
      initialInput: 'https://github.com/org/app/pull/99',
    })
    closeWorktreeAction()
    hooks.unmount()

    // Local changes view returns null
    expect(await hooks.flush(() => ForgeDiffToolbarCheckoutButton({
      target: { sessionId: 's-1', source: { kind: 'local' } },
      form: 'bar',
      close: () => {},
      gitCache: cache,
      resolveSessionPath: () => '/code/app',
      t,
    }))).toBeNull()
    hooks.unmount()

    // Change request view in folded menu form calls close() and opens prefilled modal
    const closeSpy = vi.fn()
    const menuEl = await hooks.flush(() => ForgeDiffToolbarCheckoutButton({
      target: { sessionId: 's-1', source: { kind: 'change', url: 'https://github.com/org/app/pull/101' } },
      form: 'menu',
      close: closeSpy,
      gitCache: cache,
      resolveSessionPath: () => '/code/app',
      t,
    }))
    const menuBtn = nodes(menuEl).find(n => n.type === 'menuitem')!
    ;(menuBtn.props.onSelect as () => void)()
    expect(closeSpy).toHaveBeenCalled()
    expect(getWorktreeAction()).toEqual({
      kind: 'checkout-pr',
      repoPath: '/code/app',
      repoName: 'app',
      initialInput: 'https://github.com/org/app/pull/101',
    })
  })

  it('switches Forge slot button to sync mode with update default when already inside the target PR worktree', async () => {
    const cache = createWorkspaceGitCache(async () => ({
      ok: true,
      facts: {
        '/code/app/.dsh/gitworktree/github-pr-99': {
          repoRoot: '/code/app',
          repoName: 'app',
          branch: 'github-pr-99',
          main: false,
          baseBranch: 'PR #99 → main',
        },
      },
    }))
    await cache.syncPaths(['/code/app/.dsh/gitworktree/github-pr-99'])

    const cardEl = await hooks.flush(() => ForgeCardCheckoutButton({
      sessionId: 's-pr',
      url: 'https://github.com/org/app/pull/99',
      gitCache: cache,
      resolveSessionPath: () => '/code/app/.dsh/gitworktree/github-pr-99',
      t,
    }))
    const cardBtn = nodes(cardEl).find(n => n.type === 'button')!
    expect(cardBtn.props['aria-label']).toBe('forgeSlot.syncTooltip')
    ;(cardBtn.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: () => {} })
    expect(getWorktreeAction()).toEqual({
      kind: 'checkout-pr',
      repoPath: '/code/app',
      repoName: 'app',
      initialInput: 'https://github.com/org/app/pull/99',
      initialIfExists: 'update',
    })
    closeWorktreeAction()

    const hoverEl = SidebarWorktreeHover({
      sessionId: 's-pr',
      gitCache: cache,
      resolveSessionPath: () => '/code/app/.dsh/gitworktree/github-pr-99',
      shouldDecorateSession: () => true,
      t,
    })
    expect(JSON.stringify(hoverEl)).toContain('sidebar.worktreeHoverPr')
    expect(JSON.stringify(hoverEl)).toContain('PR #99 → main')
  })

  it('yields sidebar trailing & hover badges when session is managed by forgeWorktree', async () => {
    const cache = createWorkspaceGitCache(async () => ({
      ok: true,
      facts: {
        '/code/app/.agents/worktrees/dsh-1': { repoRoot: '/code/app', repoName: 'app', branch: 'dsh-1', main: false },
      },
    }))
    await cache.syncPaths(['/code/app/.agents/worktrees/dsh-1'])

    const trailingHidden = SidebarWorktreeTrailing({
      sessionId: 's-forge',
      gitCache: cache,
      resolveSessionPath: () => '/code/app/.agents/worktrees/dsh-1',
      shouldDecorateSession: () => false,
      t,
    })
    expect(trailingHidden).toBeNull()

    const hoverHidden = SidebarWorktreeHover({
      sessionId: 's-forge',
      gitCache: cache,
      resolveSessionPath: () => '/code/app/.agents/worktrees/dsh-1',
      shouldDecorateSession: () => false,
      t,
    })
    expect(hoverHidden).toBeNull()

    const trailingVisible = SidebarWorktreeTrailing({
      sessionId: 's-ours',
      gitCache: cache,
      resolveSessionPath: () => '/code/app/.agents/worktrees/dsh-1',
      shouldDecorateSession: () => true,
      t,
    })
    expect(trailingVisible).not.toBeNull()
  })

  it('clears providerOverride when switching from an unrecognized remote to a recognized GitHub remote and infers gitlab for !42', async () => {
    vi.useFakeTimers()
    const multiContext: PrContextResult & { ok: true } = {
      ok: true,
      repoRoot: '/code/app',
      repoName: 'app',
      remotes: [
        { name: 'corp', url: 'https://git.corp.local/team/app.git', provider: null, host: 'git.corp.local', owner: 'team', repo: 'app' },
        { name: 'origin', url: 'https://github.com/org/app.git', provider: 'github', host: 'github.com', owner: 'org', repo: 'app' },
      ],
      defaultRemote: 'corp',
      forge: { available: false, readiness: 'unavailable' },
      candidates: [],
    }
    vi.mocked(requestPrContext).mockResolvedValue(multiContext)
    vi.mocked(requestPrResolve).mockImplementation(async (body): Promise<PrResolveResult & { ok: true }> => ({
      ok: true,
      provider: body.provider ?? 'github',
      number: 42,
      remote: body.remote ?? 'origin',
      refSpec: (body.provider ?? 'github') === 'gitlab' ? 'refs/merge-requests/42/head' : 'refs/pull/42/head',
      localBranch: (body.provider ?? 'github') === 'gitlab' ? 'gitlab-mr-42' : 'github-pr-42',
      targetPath: '/code/app/.dsh/gitworktree/pr-42',
      canonicalUrl: null,
      existingBranch: false,
    }))

    const props: CheckoutPrModalProps = {
      repoPath: '/code/app',
      repoName: 'app',
      initialInput: '!42',
      forgeTrackAvailable: false,
      adoptWorktree: vi.fn(async () => {}),
      onCreated: vi.fn(),
      onClose: vi.fn(),
      t,
    }
    let tree = await hooks.flush(() => CheckoutPrModal(props))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal(props))

    // `!42` on an unrecognized self-hosted remote defaults provider picker to `gitlab`
    expect(vi.mocked(requestPrResolve).mock.calls.at(-1)?.[0]).toMatchObject({ remote: 'corp', provider: 'gitlab' })

    // Explicitly switch provider to GitLab MR while on unrecognized remote `corp`
    const providerSelect = nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === 'prModal.providerLabel')!
    ;(providerSelect.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'gitlab' } })
    tree = await hooks.flush(() => CheckoutPrModal(props))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal(props))
    expect(vi.mocked(requestPrResolve).mock.calls.at(-1)?.[0]).toMatchObject({ remote: 'corp', provider: 'gitlab' })

    // Switch remote to recognized GitHub `origin` -> providerOverride must NOT leak as `gitlab`
    const remoteSelect = nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === 'prModal.remoteLabel')!
    ;(remoteSelect.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'origin' } })
    tree = await hooks.flush(() => CheckoutPrModal(props))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal(props))
    const lastResolve = vi.mocked(requestPrResolve).mock.calls.at(-1)?.[0]
    expect(lastResolve?.remote).toBe('origin')
    expect(lastResolve?.provider).toBeUndefined()
  })

  it('does not reset modal context or user-selected ifExists=update when t reference changes, and formats worktree_diverged', async () => {
    vi.useFakeTimers()
    const ctxResult: PrContextResult & { ok: true } = {
      ok: true,
      repoRoot: '/code/app',
      repoName: 'app',
      remotes: [
        { name: 'origin', url: 'https://github.com/org/app.git', provider: 'github', host: 'github.com', owner: 'org', repo: 'app' },
      ],
      defaultRemote: 'origin',
      forge: { available: false, readiness: 'unavailable' },
      candidates: [],
    }
    const resolveResult: PrResolveResult & { ok: true } = {
      ok: true,
      provider: 'github',
      number: 55,
      remote: 'origin',
      refSpec: 'refs/pull/55/head',
      localBranch: 'github-pr-55',
      targetPath: '/code/app/.dsh/gitworktree/github-pr-55',
      canonicalUrl: 'https://github.com/org/app/pull/55',
      existingWorktreePath: '/code/app/.dsh/gitworktree/github-pr-55',
      existingBranch: true,
    }
    vi.mocked(requestPrContext).mockResolvedValue(ctxResult)
    vi.mocked(requestPrResolve).mockResolvedValue(resolveResult)

    const baseProps: CheckoutPrModalProps = {
      repoPath: '/code/app',
      repoName: 'app',
      initialInput: '55',
      forgeTrackAvailable: false,
      adoptWorktree: vi.fn(async () => {}),
      onCreated: vi.fn(),
      onClose: vi.fn(),
      t,
    }
    let tree = await hooks.flush(() => CheckoutPrModal(baseProps))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal(baseProps))
    expect(vi.mocked(requestPrContext)).toHaveBeenCalledTimes(1)

    // User switches radio from reuse -> update
    const radios = nodes(tree).filter(n => n.type === 'input' && n.props.type === 'radio')
    expect(radios).toHaveLength(2)
    ;(radios[1]!.props.onChange as () => void)()
    tree = await hooks.flush(() => CheckoutPrModal(baseProps))
    expect(nodes(tree).filter(n => n.type === 'input' && n.props.type === 'radio')[1]!.props.checked).toBe(true)

    // Re-render with a fresh `t` callback reference -> must NOT re-fetch context or reset ifExists
    const t2: PropsLocale<'git-worktree'>['t'] = (key, params) => t(key, params)
    tree = await hooks.flush(() => CheckoutPrModal({ ...baseProps, t: t2 }))
    await vi.advanceTimersByTimeAsync(200)
    tree = await hooks.flush(() => CheckoutPrModal({ ...baseProps, t: t2 }))
    expect(vi.mocked(requestPrContext)).toHaveBeenCalledTimes(1)
    expect(nodes(tree).filter(n => n.type === 'input' && n.props.type === 'radio')[1]!.props.checked).toBe(true)

    // formatPrError fallback handles worktree_diverged explicitly
    expect(formatPrError('raw', 'worktree_diverged', { branch: 'github-pr-55' }, t))
      .toBe('prModal.divergedTitle:{"branch":"github-pr-55"}')
  })
})
