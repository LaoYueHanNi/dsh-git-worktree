import { beforeAll, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { GroupedSidebarInjected } from '../src/client/GroupedSidebar.tsx'

// The sidebar-seat lifecycle addresses window timers directly (browser code);
// node's test environment just needs the two members aliased onto globalThis.
beforeAll(() => {
  vi.stubGlobal('window', globalThis)
})

/**
 * Scripted client context: only the faces `apply` touches. `slots.inject`
 * invokes the factory immediately (registration is the factory's body) and
 * captures what was registered, so the tests reach the injected business
 * faces without rendering any component. Host 0.1.2-rc.1 shape: session start
 * and directory picking live on `uiWorkspace`, Host facts on `remote.$host`
 * (invalidated through `connection/reset`), and the legacy
 * `workspaces.startSession` / `pickDirectory` / `connection.hostDescription`
 * faces no longer exist.
 */
class FakeCtx {
  readonly locale = { register: (ns: string, dict: unknown) => { this.namespaces.push([ns, dict]) } }
  readonly namespaces: Array<[string, unknown]> = []
  readonly registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
  readonly workspaces = {
    created: [] as Array<{ path: string }>,
    /** The legacy navigation face; a migration regression calls this. */
    startSessionCalls: 0,
    list: {
      getSnapshot: () => ({ items: [], archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
    async create(input: { path: string }): Promise<{ workspaceId: string }> {
      this.created.push(input)
      return { workspaceId: `ws-${String(this.created.length)}` }
    },
    startSession(): void {
      this.startSessionCalls += 1
    },
  }
  readonly sessions = {
    list: {
      getSnapshot: () => ({ ids: [], byId: {}, current: undefined }),
      subscribe: () => () => {},
    },
    opened: [] as string[],
    searchResultLimit: 8,
    async search(): Promise<never> {
      throw new Error('not expected in these tests')
    },
    open(sessionId: string): void {
      this.opened.push(sessionId)
    },
    fork(): Promise<string> {
      return Promise.resolve('forked')
    },
  }
  readonly uiWorkspace = {
    started: [] as Array<[string | undefined]>,
    picked: 0,
    startSession(workspaceId?: string): void {
      this.started.push([workspaceId])
    },
    async pickDirectory(): Promise<string | null> {
      this.picked += 1
      return '/picked/root'
    },
  }
  readonly remote = { $host: { home: '/home/x', isLoopback: true } }
  readonly resetListeners: Array<() => void> = []
  private readonly scope = {
    getSnapshot: () => ({ status: 'ready', value: { rootDir: '/scope/root', groupSidebar: true }, user: undefined, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }

  on(event: string, listener: () => void): () => void {
    if (event !== 'connection/reset') return () => {}
    this.resetListeners.push(listener)
    return () => {
      const index = this.resetListeners.indexOf(listener)
      if (index >= 0) this.resetListeners.splice(index, 1)
    }
  }

  emitReset(): void {
    for (const listener of this.resetListeners) listener()
  }

  effect(fn: () => unknown): () => void {
    fn()
    return () => {}
  }

  readonly slots = {
    inject: (name: string, factory: () => unknown): (() => void) => {
      this.slotNames.push(name)
      void factory()
      return () => {}
    },
    register: (options: Record<string, unknown>, component: unknown): (() => void) => {
      this.registered.push({ options, component })
      return () => {}
    },
    entries: (_name: string): unknown[] => [],
    subscribe: (name: string, listener: () => void): (() => void) => {
      this.directoryFlowListeners.push([name, listener])
      return () => {}
    },
  }

  readonly slotNames: string[] = []
  readonly directoryFlowListeners: Array<[string, () => void]> = []

  readonly settingsScope = {
    bind: <T, >(_spec: { namespace: string }) => this.scope as unknown as {
      getSnapshot(): { status: string; value: T | undefined; user: unknown; writable: boolean }
      subscribe(listener: () => void): () => void
      set(field: string, value: unknown): Promise<void>
      unset(field: string): Promise<void>
    },
  }

  /** The options one slot registration captured, by slot name. */
  registrationOf(name: string): Record<string, unknown> {
    const hit = this.registered.find(r => r.options.name === name)
    if (hit === undefined) throw new Error(`no registration for slot ${name}`)
    return hit.options
  }
}

describe('client apply', () => {
  it('declares the uiWorkspace service (session start and directory picking left workspaces)', () => {
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

  it('rides the card browse button on uiWorkspace.pickDirectory', async () => {
    const ctx = new FakeCtx()
    apply(ctx as never)
    const options = ctx.registrationOf('settings.plugin.item')
    expect(options.key).toBe('git-worktree')
    const face = (options.inject as () => { pickDirectory: () => Promise<string | null> })()

    await expect(face.pickDirectory()).resolves.toBe('/picked/root')
    expect(ctx.uiWorkspace.picked).toBe(1)
  })

  it('mounts the grouped sidebar seat on uiWorkspace and the remote $host facts', () => {
    const ctx = new FakeCtx()
    apply(ctx as never)
    const options = ctx.registrationOf('sidebar.workspaces')
    expect(options.priority).toBe(-1)
    const face = (options.inject as () => GroupedSidebarInjected)()

    face.startSession('ws-1')
    expect(ctx.uiWorkspace.started).toContainEqual(['ws-1'])
    expect(ctx.workspaces.startSessionCalls).toBe(0)

    expect(face.hostInfo.getSnapshot()).toEqual({ home: '/home/x', isLoopback: true })
    const listener = vi.fn()
    const stop = face.hostInfo.subscribe(listener)
    ctx.emitReset()
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    ctx.emitReset()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
