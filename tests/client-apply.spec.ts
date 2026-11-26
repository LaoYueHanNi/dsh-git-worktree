import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { BranchChipInjected } from '../src/client/slots.ts'
import { ROUTE_DEFERRED_ACTION, ROUTE_EXISTS, ROUTE_REMOVE, ROUTE_SESSION_CWD } from '../src/wire.ts'

/**
 * Scripted client context: only the faces `apply` touches. `slots.inject`
 * invokes the factory immediately (registration is the factory's body) and
 * captures what was registered, so the tests reach the injected business
 * faces without rendering any component. Host 0.1.6-alpha.2 shape: session
 * start lives on `uiWorkspace` and the bundle configuration card dispatches
 * under `plugins.bundle.config`, registered only while the shared describe
 * face reports the `git-worktree` namespace as served.
 */
class FakeCtx {
  readonly locale = { register: (ns: string, dict: unknown) => { this.namespaces.push([ns, dict]) } }
  readonly namespaces: Array<[string, unknown]> = []
  readonly registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
  /** Workspace rows the list snapshot serves (pathKey-matched by takers). */
  workspaceItems: Array<{ path: string; workspaceId: string; sessionIds: string[] }> = []
  /** Registry-global archive set the list snapshot serves. */
  archivedSessionIds: string[] = []
  /** Session summaries the sessions snapshot serves, by id. */
  sessionSummaries: Record<string, { running: boolean; blank: boolean; origin?: 'subagent'; updatedAt: number }> = {}
  readonly archiveCalls: string[] = []
  readonly deletedWorkspaces: string[] = []
  readonly workspaces = {
    created: [] as Array<{ path: string }>,
    /** The legacy navigation face; a migration regression calls this. */
    startSessionCalls: 0,
    async create(input: { path: string }): Promise<{ workspaceId: string }> {
      this.created.push(input)
      return { workspaceId: `ws-${String(this.created.length)}` }
    },
    startSession(): void {
      this.startSessionCalls += 1
    },
    archiveSession: (sessionId: string): Promise<void> => {
      this.archiveCalls.push(sessionId)
      return Promise.resolve()
    },
    delete: (workspaceId: string): Promise<void> => {
      this.deletedWorkspaces.push(workspaceId)
      return Promise.resolve()
    },
    list: {
      getSnapshot: () => ({ items: this.workspaceItems, archivedSessionIds: this.archivedSessionIds }),
    },
  }
  readonly sessions = {
    list: {
      getSnapshot: () => ({ byId: this.sessionSummaries }),
    },
  }
  readonly uiWorkspace = {
    started: [] as Array<[string | undefined]>,
    startSession(workspaceId?: string): void {
      this.started.push([workspaceId])
    },
  }
  readonly remote = { $host: { home: '/home/x', isLoopback: true } }

  effect(fn: () => unknown): () => void {
    fn()
    return () => {}
  }

  readonly slots = {
    inject: (name: string, factory: () => unknown): (() => void) => {
      this.slotNames.push(name)
      void factory()
      return () => {
        const index = this.slotNames.lastIndexOf(name)
        if (index >= 0) this.slotNames.splice(index, 1)
      }
    },
    register: (options: Record<string, unknown>, component: unknown): (() => void) => {
      this.registered.push({ options, component })
      return () => {}
    },
  }

  readonly slotNames: string[] = []

  /** Namespaces the describe face currently reports as served. */
  servedNamespaces: string[] = ['git-worktree']
  private readonly describeListeners = new Set<() => void>()
  readonly configForms = {
    get: <T, >(_entryId: string) => this.scope as unknown as {
      getSnapshot(): { status: string; value: T | undefined; user: unknown; writable: boolean }
      subscribe(listener: () => void): () => void
      set(field: string, value: unknown): Promise<boolean>
      unset(field: string): Promise<boolean>
    },
    describe: () => this.describeFace,
  }

  private readonly describeFace = {
    getSnapshot: () => ({
      status: this.servedNamespaces.length > 0 ? 'ready' : 'ready',
      view: {
        namespaces: this.servedNamespaces.map(ns => ({ ns })),
        writable: true,
        hasDocument: true,
      },
    }),
    subscribe: (listener: () => void) => {
      this.describeListeners.add(listener)
      return () => { this.describeListeners.delete(listener) }
    },
    ensure: async () => {},
  }

  private readonly scope = {
    getSnapshot: () => ({ status: 'ready', value: { rootDir: '/scope/root' }, user: undefined, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }

  /** The options one slot registration captured, by slot name. */
  registrationOf(name: string): Record<string, unknown> {
    const hit = this.registered.find(r => r.options.name === name)
    if (hit === undefined) throw new Error(`no registration for slot ${name}`)
    return hit.options
  }
}

describe('client apply', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('declares the uiWorkspace service (session start left workspaces)', () => {
    expect(inject).toContain('uiWorkspace')
  })

  it('adopts a worktree through workspaces.create then uiWorkspace.startSession', async () => {
    const ctx = new FakeCtx()
    apply(ctx as never)
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => { adoptWorktree: (path: string) => Promise<void> })()

    await face.adoptWorktree('/wt/repo-main')

    expect(ctx.workspaces.created).toEqual([{ path: '/wt/repo-main' }])
    expect(ctx.uiWorkspace.started).toEqual([['ws-1']])
    expect(ctx.workspaces.startSessionCalls).toBe(0)
  })

  it('describes a worktree removal from the live snapshots', () => {
    const ctx = new FakeCtx()
    ctx.workspaceItems = [{ path: '/repo/.dsh/gitworktree/feat', workspaceId: 'ws-1', sessionIds: ['a', 'b', 'c', 'd', 'e'] }]
    ctx.archivedSessionIds = ['e']
    // Two rows qualify (a, and the running b — a running session still
    // counts toward the archive set, which is exactly why the UI withholds
    // the verb for it) among a blank (c), a subagent (d) and an
    // already-archived one (e) — the shared archive qualification every
    // removal entry spells as "archived too".
    ctx.sessionSummaries = {
      a: { running: false, blank: false, updatedAt: 1 },
      b: { running: true, blank: false, updatedAt: 2 },
      c: { running: false, blank: true, updatedAt: 3 },
      d: { running: false, blank: false, origin: 'subagent', updatedAt: 4 },
      e: { running: false, blank: false, updatedAt: 5 },
    }
    apply(ctx as never)
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()

    expect(face.openGraphByDefault()).toBe(false)
    expect(face.describeWorktreeRemoval('/repo/.dsh/gitworktree/feat')).toEqual({ running: true, archiveCount: 2 })
    expect(face.describeWorktreeRemoval('/not/registered')).toEqual({ running: false, archiveCount: 0 })
  })

  it('removes a worktree through the shared flow: git first, then the DSH half', async () => {
    const ctx = new FakeCtx()
    ctx.workspaceItems = [{ path: '/repo/.dsh/gitworktree/feat', workspaceId: 'ws-1', sessionIds: ['a'] }]
    ctx.sessionSummaries = { a: { running: false, blank: false, updatedAt: 1 } }
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }): Promise<Response> => {
      if (url === ROUTE_REMOVE || url === ROUTE_EXISTS) {
        calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
      }
      if (url === ROUTE_REMOVE) return new Response(JSON.stringify({ path: '', pruned: false }), { status: 200 })
      return new Response(JSON.stringify({ exists: {}, facts: {} }), { status: 200 })
    })
    apply(ctx as never)
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()

    await face.removeWorktree('/repo/.dsh/gitworktree/feat', true)

    expect(calls).toEqual([{ url: ROUTE_REMOVE, body: { path: '/repo/.dsh/gitworktree/feat', force: true } }])
    expect(ctx.archiveCalls).toEqual(['a'])
    expect(ctx.deletedWorkspaces).toEqual(['ws-1'])
  })

  it('continues the DSH half when git already took the folder away', async () => {
    const ctx = new FakeCtx()
    ctx.workspaceItems = [{ path: '/repo/.dsh/gitworktree/feat', workspaceId: 'ws-1', sessionIds: [] }]
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      // git refuses (a locked handle) but the folder is GONE — the Windows
      // half-removal shape: the flow probes, sees it missing, continues.
      if (url === ROUTE_REMOVE) return new Response(JSON.stringify({ error: 'rmdir failed' }), { status: 500 })
      if (url === ROUTE_EXISTS) return new Response(JSON.stringify({ exists: { '/repo/.dsh/gitworktree/feat': false } }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    apply(ctx as never)
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()

    await face.removeWorktree('/repo/.dsh/gitworktree/feat', false)

    expect(ctx.deletedWorkspaces).toEqual(['ws-1'])
  })

  it('surfaces a refused removal as a rejection for the caller toast', async () => {
    const ctx = new FakeCtx()
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url === ROUTE_REMOVE) return new Response(JSON.stringify({ error: 'dirty worktree' }), { status: 400 })
      if (url === ROUTE_EXISTS) return new Response(JSON.stringify({ exists: { '/repo/.dsh/gitworktree/feat': true } }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    apply(ctx as never)
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()

    await expect(face.removeWorktree('/repo/.dsh/gitworktree/feat', false)).rejects.toThrow('dirty worktree')
    expect(ctx.deletedWorkspaces).toEqual([])
  })

  it('registers the bundle configuration card keyed by the package name', () => {
    const ctx = new FakeCtx()
    apply(ctx as never)
    expect(ctx.slotNames).toContain('plugins.bundle.config')
    const options = ctx.registrationOf('plugins.bundle.config')
    expect(options.key).toBe('@laoyuehanni/dsh-git-worktree')
    // The injected face carries the manager dialog and the form actions —
    // and no directory picker anymore (the legacy root is read-only).
    const face = options.inject as () => Record<string, unknown>
    const injected = face()
    expect(injected.manager).toBeDefined()
    expect('pickDirectory' in injected).toBe(false)
  })

  it('leaves no trace while the Host namespace is not served', () => {
    const ctx = new FakeCtx()
    ctx.servedNamespaces = []
    apply(ctx as never)
    expect(ctx.slotNames).not.toContain('plugins.bundle.config')
    // The chip is namespace-independent and stays.
    expect(ctx.slotNames).toContain('conversation.input.left')
  })

  it('prefers SyncedConfig over configForms for read-only switches when provided', () => {
    const ctx = new FakeCtx()
    let openGraph = true
    apply(ctx as never, {
      openGraphByDefault: {
        get: () => openGraph,
        subscribe: () => () => {},
      },
    })
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()

    expect(face.openGraphByDefault()).toBe(true)
    openGraph = false
    expect(face.openGraphByDefault()).toBe(false)
  })

  it('falls back to configForms when SyncedConfig is absent', () => {
    const ctx = new FakeCtx()
    const origGet = ctx.configForms.get
    ctx.configForms.get = (<T, >(entryId: string) => {
      const base = origGet<T>(entryId)
      return {
        ...base,
        getSnapshot: () => ({ status: 'ready', value: { openGraphByDefault: true } as unknown as T, user: undefined, writable: true }),
      }
    }) as typeof ctx.configForms.get
    apply(ctx as never)
    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()

    expect(face.openGraphByDefault()).toBe(true)
  })

  it('registers the global toast host in shell.overlay and injects openWorktree into the manager face', async () => {
    const ctx = new FakeCtx()
    apply(ctx as never)
    expect(ctx.slotNames).toContain('shell.overlay')
    expect(ctx.slotNames).toContain('sidebar.session.row.trailing')
    expect(ctx.slotNames).toContain('sidebar.session.row.hover')
    expect(ctx.slotNames).toContain('sidebar.workspaces.session.menu.item')
    expect(ctx.registered.some(r => r.options.name === 'shell.overlay' && r.options.id === 'git-worktree-actions')).toBe(true)
    const options = ctx.registrationOf('plugins.bundle.config')
    const injected = (options.inject as () => { manager: { openWorktree: (path: string) => Promise<void> } })()

    await injected.manager.openWorktree('/repo/.dsh/gitworktree/feat-a')

    expect(ctx.workspaces.created).toEqual([{ path: '/repo/.dsh/gitworktree/feat-a' }])
    expect(ctx.uiWorkspace.started).toEqual([['ws-1']])
  })

  it('registers native contextMenus and unmounts legacy session menu fallback when contextMenus is available', () => {
    const ctx = new FakeCtx()
    const menuRegistrations: Array<{ target: string; id: string }> = []
    const menuCtx = Object.assign(ctx, {
      locale: {
        register: ctx.locale.register,
        bind: () => (key: string) => key,
      },
      contextMenus: {
        register: (contribution: { target: string; id: string }) => {
          menuRegistrations.push({ target: contribution.target, id: contribution.id })
          return () => {}
        },
      },
      inject: (deps: readonly string[], cb: (scope: unknown) => void) => {
        if (deps.includes('contextMenus')) cb(menuCtx)
      },
    })

    apply(menuCtx as never)

    expect(menuRegistrations).toEqual([
      { target: 'workspace', id: 'git-worktree.workspace' },
      { target: 'session', id: 'git-worktree.session' },
      { target: 'sessionHeader', id: 'git-worktree.sessionHeader' },
    ])
    expect(ctx.slotNames).toContain('contextMenu.icon')
    expect(ctx.slotNames).not.toContain('sidebar.workspaces.session.menu.item')
  })

  it('never reads ctx.remote.forgePanel without inject and bridges remote.forgePanel lazily via ctx.inject', async () => {
    const ctx = new FakeCtx()
    // Simulate Cordis ReflectService throwing when accessing an un-injected sub-service.
    Object.defineProperty(ctx.remote, 'forgePanel', {
      configurable: true,
      get() {
        throw new Error('cannot get property "remote.forgePanel" without inject')
      },
    })
    const trackCalls: Array<[string, string]> = []
    const openedSessions: string[] = []
    let forgeDispose: (() => void) | undefined
    let activateForge: (() => void) | undefined
    const hostCtx = Object.assign(ctx, {
      uiWorkspace: {
        ...ctx.uiWorkspace,
        connectWorkspace: async (wsId: string) => `sess-${wsId}`,
        openSession: (sessionId: string) => { openedSessions.push(sessionId) },
      },
      inject: (deps: readonly string[], cb: (scope: unknown) => void) => {
        if (deps.includes('remote.forgePanel')) {
          activateForge = () => {
            const forgeScope = {
              remote: {
                forgePanel: {
                  track: async (sessionId: string, url: string) => {
                    trackCalls.push([sessionId, url])
                  },
                },
              },
              effect: (fn: () => (() => void) | void) => {
                forgeDispose = fn() ?? undefined
                return () => { forgeDispose?.() }
              },
            }
            cb(forgeScope)
          }
        }
      },
    })

    apply(hostCtx as never)

    const actionHostReg = ctx.registered.find(r => r.options.name === 'shell.overlay' && r.options.id === 'git-worktree-actions')
    expect(actionHostReg).toBeDefined()
    // Running inject() must not throw against the strict remote proxy.
    const injected = (actionHostReg!.options.inject as () => {
      forgeTrackAvailable: () => boolean
      adoptWorktree: (path: string, opts?: { trackPrUrl?: string | null }) => Promise<void>
    })()
    expect(injected.forgeTrackAvailable()).toBe(false)

    // Activating optional remote.forgePanel enables tracking dynamically.
    activateForge?.()
    expect(injected.forgeTrackAvailable()).toBe(true)
    await injected.adoptWorktree('/repo/.dsh/gitworktree/github-pr-12', {
      trackPrUrl: 'https://github.com/org/repo/pull/12',
    })
    expect(openedSessions).toEqual(['sess-ws-1'])
    expect(trackCalls).toEqual([['sess-ws-1', 'https://github.com/org/repo/pull/12']])

    // Disposing the optional forge scope cleanly disables tracking again.
    forgeDispose?.()
    expect(injected.forgeTrackAvailable()).toBe(false)
  })

  it('reuses the current blank session in place and binds trackPrUrl when switchSessionDirectory is enabled', async () => {
    const ctx = new FakeCtx()
    ctx.workspaceItems = [{ path: '/repo', workspaceId: 'ws-main', sessionIds: ['blank-1'] }]
    ctx.sessionSummaries = { 'blank-1': { running: false, blank: true, updatedAt: 1 } }
    const trackCalls: Array<[string, string]> = []
    const sessionCwdCalls: Array<{ sessionId: string; path: string }> = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }): Promise<Response> => {
      if (url === ROUTE_SESSION_CWD) {
        sessionCwdCalls.push(JSON.parse(init?.body ?? '{}') as { sessionId: string; path: string })
        return new Response(JSON.stringify({ sessionId: 'blank-1', path: '/repo/.dsh/gitworktree/github-pr-42' }), { status: 200 })
      }
      if (url === ROUTE_DEFERRED_ACTION) {
        return new Response(JSON.stringify({ state: null }), { status: 200 })
      }
      return new Response(JSON.stringify({ facts: {} }), { status: 200 })
    })
    const hostCtx = Object.assign(ctx, {
      inject: (deps: readonly string[], cb: (scope: unknown) => void) => {
        if (deps.includes('remote.forgePanel')) {
          cb({
            remote: {
              forgePanel: {
                track: async (sessionId: string, url: string) => { trackCalls.push([sessionId, url]) },
              },
            },
            effect: () => () => {},
          })
        }
      },
    })

    apply(hostCtx as never, {
      switchSessionDirectory: { get: () => true, subscribe: () => () => {} },
    })

    const options = ctx.registrationOf('conversation.input.left')
    const face = (options.inject as () => BranchChipInjected)()
    await face.adoptWorktree('/repo/.dsh/gitworktree/github-pr-42', {
      reuseBlankSessionId: 'blank-1',
      repoRoot: '/repo',
      trackPrUrl: 'https://github.com/org/repo/pull/42',
    })

    expect(sessionCwdCalls).toEqual([{ sessionId: 'blank-1', path: '/repo/.dsh/gitworktree/github-pr-42' }])
    expect(trackCalls).toEqual([['blank-1', 'https://github.com/org/repo/pull/42']])
    expect(ctx.workspaces.created).toEqual([])
  })
})
