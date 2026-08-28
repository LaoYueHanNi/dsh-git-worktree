import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

/**
 * Scripted client context: only the faces `apply` touches. `slots.inject`
 * invokes the factory immediately (registration is the factory's body) and
 * captures what was registered, so the tests reach the injected business
 * faces without rendering any component.
 */
class FakeCtx {
  readonly locale = { register: (ns: string, dict: unknown) => { this.namespaces.push([ns, dict]) } }
  readonly namespaces: Array<[string, unknown]> = []
  readonly registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
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
  private readonly scope = {
    getSnapshot: () => ({ status: 'ready', value: { rootDir: '/scope/root' }, user: undefined, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
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
  }

  readonly slotNames: string[] = []

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
})
