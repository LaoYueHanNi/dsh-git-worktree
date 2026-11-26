import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DeferredWorktreeCoordinator, type DeferredAgentLike } from '../src/deferred-worktree.ts'
import {
  handleArmDeferredWorktree,
  handleDeferredWorktreeAction,
  handleGetDeferredWorktree,
  type RouteDeps,
} from '../src/routes.ts'
import { ROUTE_DEFERRED, ROUTE_DEFERRED_ACTION, ROUTE_DEFERRED_ARM, ROUTE_SESSION_CWD, type DeferredWorktreeSnapshot } from '../src/wire.ts'
import type { SectionValue } from '../src/client/card-form.ts'
import { apply } from '../src/client/index.ts'
import type { BranchChipInjected } from '../src/client/slots.ts'

describe('DeferredWorktreeCoordinator', () => {
  it('arms without touching git and cancels cleanly before any message arrives', () => {
    const createWorktree = vi.fn()
    const setWorkingDirectory = vi.fn()
    const coordinator = new DeferredWorktreeCoordinator({ createWorktree, setWorkingDirectory })
    const snapshots: DeferredWorktreeSnapshot[] = []
    coordinator.subscribe('s-1', snap => snapshots.push(snap))

    const spec = { repoPath: resolve('/repo'), branch: 'main', cutout: true, random: true }
    const armed = coordinator.arm('s-1', spec)
    expect(armed).toEqual({ kind: 'armed', spec })
    expect(coordinator.get('s-1')).toEqual(armed)
    expect(createWorktree).not.toHaveBeenCalled()

    expect(coordinator.cancel('s-1')).toBe(true)
    expect(coordinator.get('s-1')).toBeNull()
    expect(createWorktree).not.toHaveBeenCalled()
    expect(snapshots).toEqual([{ state: armed }, { state: null }])
  })

  it('holds the first inbox turn in maintenance, streams phases, switches cwd, and emits completed', async () => {
    const snapshots: DeferredWorktreeSnapshot[] = []
    const createdPath = resolve('/repo/.dsh/gitworktree/main-1a2b')
    const createWorktree = vi.fn(async (_spec, onPhase) => {
      onPhase('fetch')
      onPhase('create', 'main-1a2b')
      onPhase('copy', 'main-1a2b')
      return { path: createdPath, branch: 'main-1a2b', created: true, copyWarning: 'partial' }
    })
    const setWorkingDirectory = vi.fn(async (_agent, path) => path)
    const coordinator = new DeferredWorktreeCoordinator({ createWorktree, setWorkingDirectory })
    coordinator.subscribe('s-1', snap => snapshots.push(snap))

    coordinator.arm('s-1', { repoPath: resolve('/repo'), branch: 'main', cutout: true, random: true })

    let maintenancePromise: Promise<void> | undefined
    const agent: DeferredAgentLike = {
      session: { id: 's-1' },
      inbox: { nextTurn: [{ id: 'msg-1' }] },
      runMaintenance: (task) => {
        const controller = new AbortController()
        maintenancePromise = task(controller.signal)
        return maintenancePromise
      },
    }

    // Internal non-nextTurn message must be ignored.
    coordinator.onInboxInserted(agent, { id: 'internal-notice' })
    expect(maintenancePromise).toBeUndefined()

    coordinator.onInboxInserted(agent, { id: 'msg-1' })
    expect(maintenancePromise).toBeDefined()
    await maintenancePromise

    expect(createWorktree).toHaveBeenCalledTimes(1)
    expect(setWorkingDirectory).toHaveBeenCalledWith(agent, createdPath, expect.any(AbortSignal))
    expect(coordinator.get('s-1')).toBeNull()

    const phases = snapshots
      .filter(snap => snap.state?.kind === 'running')
      .map(snap => snap.state?.kind === 'running' ? snap.state.phase : undefined)
    expect(phases).toContain('fetch')
    expect(phases).toContain('create')
    expect(phases).toContain('copy')
    expect(phases).toContain('switch')

    const last = snapshots[snapshots.length - 1]
    expect(last).toEqual({
      state: null,
      completed: {
        path: createdPath,
        branch: 'main-1a2b',
        created: true,
        copyWarning: 'partial',
      },
    })
  })

  it('transitions to failed on error, waits in maintenance, and succeeds after retry', async () => {
    let attempt = 0
    const createdPath = resolve('/repo/.dsh/gitworktree/feat-x')
    const createWorktree = vi.fn(async (_spec, onPhase) => {
      attempt += 1
      onPhase('create', 'feat-x')
      if (attempt === 1) throw new Error('lock failed')
      return { path: createdPath, branch: 'feat-x', created: true }
    })
    const setWorkingDirectory = vi.fn(async (_agent, path) => path)
    const coordinator = new DeferredWorktreeCoordinator({ createWorktree, setWorkingDirectory })

    let markFailed!: () => void
    const failedReached = new Promise<void>((res) => { markFailed = res })
    coordinator.subscribe('s-2', (snap) => {
      if (snap.state?.kind === 'failed') markFailed()
    })

    coordinator.arm('s-2', { repoPath: resolve('/repo'), branch: 'main', cutout: true, name: 'feat-x' })

    let maintenancePromise: Promise<void> | undefined
    const agent: DeferredAgentLike = {
      session: { id: 's-2' },
      inbox: { nextTurn: [{ id: 'm-1' }] },
      runMaintenance: (task) => {
        maintenancePromise = task(new AbortController().signal)
        return maintenancePromise
      },
    }

    coordinator.onInboxInserted(agent, { id: 'm-1' })
    await failedReached

    expect(coordinator.get('s-2')).toMatchObject({
      kind: 'failed',
      phase: 'create',
      message: 'lock failed',
      resolvedBranch: 'feat-x',
    })
    expect(coordinator.retry('s-2')).toBe(true)
    await maintenancePromise

    expect(attempt).toBe(2)
    expect(coordinator.get('s-2')).toBeNull()
    expect(setWorkingDirectory).toHaveBeenCalledWith(agent, createdPath, expect.any(AbortSignal))
  })

  it('allows withdrawing a failed creation so the waiting message proceeds without a worktree', async () => {
    const createWorktree = vi.fn(async () => { throw new Error('disk full') })
    const setWorkingDirectory = vi.fn()
    const coordinator = new DeferredWorktreeCoordinator({ createWorktree, setWorkingDirectory })

    let markFailed!: () => void
    const failedReached = new Promise<void>((res) => { markFailed = res })
    coordinator.subscribe('s-3', (snap) => {
      if (snap.state?.kind === 'failed') markFailed()
    })
    coordinator.arm('s-3', { repoPath: resolve('/repo'), branch: 'dev', cutout: false })

    let maintenancePromise: Promise<void> | undefined
    const agent: DeferredAgentLike = {
      session: { id: 's-3' },
      inbox: { nextTurn: [{ id: 'm-1' }] },
      runMaintenance: (task) => {
        maintenancePromise = task(new AbortController().signal)
        return maintenancePromise
      },
    }

    coordinator.onInboxInserted(agent, { id: 'm-1' })
    await failedReached
    expect(coordinator.withdraw('s-3')).toBe(true)
    await maintenancePromise

    expect(coordinator.get('s-3')).toBeNull()
    expect(setWorkingDirectory).not.toHaveBeenCalled()
  })

  it('supports pre-step fallback on step 1 and releases waiting locks on dispose', async () => {
    const createdPath = resolve('/repo/.dsh/gitworktree/hotfix')
    const createWorktree = vi.fn(async () => ({ path: createdPath, branch: 'hotfix', created: true }))
    const setWorkingDirectory = vi.fn(async (_agent, path) => path)
    const coordinator = new DeferredWorktreeCoordinator({ createWorktree, setWorkingDirectory })

    coordinator.arm('s-4', { repoPath: resolve('/repo'), branch: 'hotfix', cutout: false })
    const agent: DeferredAgentLike = { session: { id: 's-4' } }

    // Step > 1 is ignored.
    await coordinator.onPreStep(agent, 2)
    expect(createWorktree).not.toHaveBeenCalled()

    await coordinator.onPreStep(agent, 1)
    expect(createWorktree).toHaveBeenCalledTimes(1)
    expect(setWorkingDirectory).toHaveBeenCalledWith(agent, createdPath, expect.any(AbortSignal))
    expect(coordinator.get('s-4')).toBeNull()

    // Dispose clears any remaining armed slots.
    coordinator.arm('s-5', { repoPath: resolve('/repo'), branch: 'main', cutout: true })
    await coordinator.dispose()
    expect(coordinator.get('s-5')).toBeNull()
  })
})

describe('deferred worktree HTTP route handlers', () => {
  const baseDeps = (over: Partial<RouteDeps> = {}): RouteDeps => ({
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    sectionRootDir: () => undefined,
    sectionFetchBeforeCreate: () => false,
    home: () => '/home/u',
    envHome: () => undefined,
    ...over,
  })

  it('returns 501 for arm/action and null snapshot for get when coordinator is unavailable', async () => {
    const deps = baseDeps()
    expect(await handleGetDeferredWorktree(deps, 's-1')).toEqual({ status: 200, body: { state: null } })
    expect((await handleArmDeferredWorktree(deps, { sessionId: 's-1', repoPath: resolve('/repo'), branch: 'main' })).status).toBe(501)
    expect((await handleDeferredWorktreeAction(deps, { sessionId: 's-1', action: 'cancel' })).status).toBe(501)
  })

  it('validates parameters and executes arm -> get -> cancel lifecycle', async () => {
    const coordinator = new DeferredWorktreeCoordinator({
      createWorktree: async () => ({ path: resolve('/repo/.dsh/gitworktree/feat'), branch: 'feat', created: true }),
      setWorkingDirectory: async (_a, p) => p,
    })
    const deps = baseDeps({ deferredWorktrees: coordinator })

    expect((await handleGetDeferredWorktree(deps, '')).status).toBe(400)
    expect((await handleArmDeferredWorktree(deps, { sessionId: ' ', repoPath: resolve('/repo'), branch: 'main' })).status).toBe(400)
    expect((await handleArmDeferredWorktree(deps, { sessionId: 's-1', repoPath: 'relative', branch: 'main' })).status).toBe(400)
    expect((await handleArmDeferredWorktree(deps, { sessionId: 's-1', repoPath: resolve('/repo'), branch: 'main', cutout: true, name: '-bad' })).status).toBe(400)
    expect((await handleDeferredWorktreeAction(deps, { sessionId: 's-1', action: 'bogus' })).status).toBe(400)

    const armRes = await handleArmDeferredWorktree(deps, {
      sessionId: 's-1',
      repoPath: resolve('/repo'),
      branch: 'main',
      cutout: true,
      random: true,
    })
    expect(armRes.status).toBe(200)
    expect(armRes.body).toEqual({
      state: {
        kind: 'armed',
        spec: { repoPath: resolve('/repo'), branch: 'main', cutout: true, random: true },
      },
    })

    const getRes = await handleGetDeferredWorktree(deps, 's-1')
    expect(getRes.status).toBe(200)
    expect((getRes.body as DeferredWorktreeSnapshot).state?.kind).toBe('armed')

    const cancelRes = await handleDeferredWorktreeAction(deps, { sessionId: 's-1', action: 'cancel' })
    expect(cancelRes).toEqual({ status: 200, body: { state: null } })
  })
})

describe('client apply() deferred worktree integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setupClientHarness(initialSection: SectionValue) {
    const registered: Array<{ name: string; id?: string; inject?: () => Record<string, unknown> }> = []
    let sectionSnap: ConfigFormSnapshot<SectionValue> = { status: 'ready', value: initialSection }
    const form: ConfigForm<SectionValue> = {
      getSnapshot: () => sectionSnap,
      subscribe: () => () => {},
      ensure: async () => {},
      setField: async () => {},
      unsetField: async () => {},
    }
    const createdSessions: Array<{ workspaceId?: string }> = []
    const openedSessions: string[] = []
    const cancelledOfficial: string[] = []
    const repoPath = resolve('/repo')
    const fetchCalls: Array<{ url: string; body?: unknown }> = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      const parsedBody = init?.body === undefined ? undefined : JSON.parse(init.body)
      fetchCalls.push({ url, body: parsedBody })
      if (url === ROUTE_DEFERRED_ARM) {
        return { ok: true, status: 200, json: async () => ({ state: { kind: 'armed', spec: parsedBody } }) }
      }
      if (url === ROUTE_DEFERRED_ACTION) {
        return { ok: true, status: 200, json: async () => ({ handled: true, state: null }) }
      }
      if (url.startsWith(`${ROUTE_DEFERRED}?`)) {
        return { ok: true, status: 200, json: async () => ({ state: null }) }
      }
      if (url === ROUTE_SESSION_CWD) {
        const body = parsedBody as { sessionId: string; path: string }
        return { ok: true, status: 200, json: async () => ({ sessionId: body.sessionId, path: body.path }) }
      }
      return { ok: true, status: 200, json: async () => ({ facts: {} }) }
    }))

    const ctx = {
      effect: () => () => {},
      inject: (deps: readonly string[], cb: (scope: unknown) => void) => {
        if (deps.length === 1 && deps[0] === 'remote.forgePanel') {
          cb({
            remote: {
              forgePanel: {
                cancelWorktree: async (sid: string) => { cancelledOfficial.push(sid) },
              },
            },
            effect: () => () => {},
          })
        }
      },
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      configForms: {
        get: () => form,
        describe: () => ({
          getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'git-worktree' }] } }),
          subscribe: () => () => {},
          ensure: async () => {},
        }),
      },
      workspaces: {
        list: {
          getSnapshot: () => ({
            items: [{ workspaceId: 'ws-main', path: repoPath, sessionIds: ['s-blank'] }],
            archivedSessionIds: [],
          }),
          subscribe: () => () => {},
        },
        create: async ({ path }: { path: string }) => ({ workspaceId: `ws:${path}`, path, sessionIds: [] }),
        archiveSession: async () => {},
        delete: async () => {},
      },
      sessions: {
        list: {
          getSnapshot: () => ({
            byId: { 's-blank': { running: false, blank: true, cwd: repoPath, updatedAt: 100 } },
            projectionsBySession: {},
          }),
          subscribe: () => () => {},
        },
        create: async (opts?: { workspaceId?: string }) => {
          createdSessions.push(opts ?? {})
          return `s-new-${createdSessions.length}`
        },
        refreshProjections: async () => {},
      },
      uiWorkspace: {
        startSession: () => {},
        openSession: (sid: string) => { openedSessions.push(sid) },
      },
      slots: {
        inject: (_name: string, fn: () => (() => void)) => fn(),
        register: (meta: { name: string; id?: string; inject?: () => Record<string, unknown> }) => {
          registered.push(meta)
          return () => {}
        },
      },
      connection: {},
      remote: {},
    }

    apply(ctx as never)
    const chipEntry = registered.find(entry => entry.name === 'conversation.input.left' && entry.id === 'git-worktree')
    const dockEntry = registered.find(entry => entry.name === 'conversation.input.dock' && entry.id === 'git-worktree-deferred')
    const chip = chipEntry?.inject?.() as unknown as BranchChipInjected
    return { chip, dockEntry, createdSessions, openedSessions, cancelledOfficial, fetchCalls, repoPath }
  }

  it('registers the composer-top dock slot and arms blank sessions in place without creating extra sessions', async () => {
    const h = setupClientHarness({ switchSessionDirectory: true })
    expect(h.dockEntry).toBeDefined()
    expect(h.chip.isSwitchSessionDirectory?.()).toBe(true)

    await h.chip.armDeferredWorktree?.(
      { repoPath: h.repoPath, branch: 'main', cutout: true, random: true },
      { reuseBlankSessionId: 's-blank', repoRoot: h.repoPath },
    )

    expect(h.createdSessions).toEqual([])
    expect(h.cancelledOfficial).toEqual(['s-blank'])
    expect(h.fetchCalls.some(c => c.url === ROUTE_DEFERRED_ARM && (c.body as { sessionId?: string }).sessionId === 's-blank')).toBe(true)
  })

  it('creates a new blank session under the parent repo workspace when armed from sidebar without reuseBlankSessionId', async () => {
    const h = setupClientHarness({ switchSessionDirectory: true })

    await h.chip.armDeferredWorktree?.(
      { repoPath: h.repoPath, branch: 'main', cutout: true, name: 'feat-a' },
      { repoRoot: h.repoPath },
    )

    expect(h.createdSessions).toEqual([{ workspaceId: 'ws-main' }])
    expect(h.cancelledOfficial).toEqual(['s-new-1'])
    expect(h.openedSessions).toEqual(['s-new-1'])
    expect(h.fetchCalls.some(c => c.url === ROUTE_DEFERRED_ARM && (c.body as { sessionId?: string }).sessionId === 's-new-1')).toBe(true)
  })

  it('cancels any armed deferred worktree before immediately switching a blank session directory', async () => {
    const h = setupClientHarness({ switchSessionDirectory: true })
    const existingWt = resolve('/repo/.dsh/gitworktree/existing')

    await h.chip.adoptWorktree(existingWt, { reuseBlankSessionId: 's-blank', repoRoot: h.repoPath })

    expect(h.fetchCalls.some(c =>
      c.url === ROUTE_DEFERRED_ACTION
      && (c.body as { sessionId?: string; action?: string }).sessionId === 's-blank'
      && (c.body as { action?: string }).action === 'cancel')).toBe(true)
    expect(h.fetchCalls.some(c => c.url === ROUTE_SESSION_CWD)).toBe(true)
  })

  it('reuses the active unarmed main-repo blank session when armed from sidebar without reuseBlankSessionId', async () => {
    const h = setupClientHarness({ switchSessionDirectory: true })
    // Simulate s-blank currently retained by mainView on the parent repo root.
    const repoPath = h.repoPath
    const registered: Array<{ name: string; inject?: () => unknown }> = []
    const createdSessions: unknown[] = []
    const armedPayloads: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.startsWith(`${ROUTE_DEFERRED}?`)) {
        return { ok: true, status: 200, json: async () => ({ state: null }) }
      }
      if (url === ROUTE_DEFERRED_ARM) {
        const body = JSON.parse(init?.body ?? '{}')
        armedPayloads.push(body)
        return { ok: true, status: 200, json: async () => ({ state: { kind: 'armed', spec: body } }) }
      }
      return { ok: true, status: 200, json: async () => ({ facts: {} }) }
    }))
    const form: ConfigForm<SectionValue> = {
      getSnapshot: () => ({ status: 'ready', writable: true, value: { switchSessionDirectory: true } }),
      subscribe: () => () => {},
      ensure: async () => {},
      setField: async () => {},
      unsetField: async () => {},
    }
    apply({
      effect: () => () => {},
      locale: { register: () => () => {}, bind: () => (k: string) => k },
      configForms: {
        get: () => form,
        describe: () => ({ getSnapshot: () => ({ status: 'ready', view: { namespaces: [] } }), subscribe: () => () => {}, ensure: async () => {} }),
      },
      workspaces: {
        list: {
          getSnapshot: () => ({ items: [{ workspaceId: 'ws-main', path: repoPath, sessionIds: ['s-active-blank'] }], archivedSessionIds: [] }),
          subscribe: () => () => {},
        },
        create: async () => ({ workspaceId: 'ws-main', path: repoPath, sessionIds: [] }),
        archiveSession: async () => {},
        delete: async () => {},
      },
      sessions: {
        list: {
          getSnapshot: () => ({
            byId: { 's-active-blank': { running: false, blank: true, cwd: repoPath, updatedAt: 100, retainedBy: { mainView: 1 } } },
            projectionsBySession: {},
          }),
          subscribe: () => () => {},
        },
        create: async (opts: unknown) => { createdSessions.push(opts); return 's-extra' },
        refreshProjections: async () => {},
      },
      uiWorkspace: { startSession: () => {}, openSession: () => {} },
      slots: {
        inject: (_name: string, fn: () => (() => void)) => fn(),
        register: (meta: { name: string; inject?: () => unknown }) => { registered.push(meta); return () => {} },
      },
      connection: {},
      remote: {},
    } as never)

    const chip = registered.find(r => r.name === 'conversation.input.left')?.inject?.() as BranchChipInjected
    await chip.armDeferredWorktree?.({ repoPath, branch: 'main', cutout: true, random: true }, { repoRoot: repoPath })

    expect(createdSessions).toEqual([])
    expect(armedPayloads).toMatchObject([{ sessionId: 's-active-blank', repoPath, branch: 'main', cutout: true, random: true }])
  })
})
