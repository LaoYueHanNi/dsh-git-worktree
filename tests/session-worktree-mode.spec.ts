import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { generateRandomBranchName } from '../src/normalize.ts'
import { randomCutoutBranchName, readWorktreeBaseBranch, writeWorktreeBaseBranch, type Exec } from '../src/git.ts'
import { handleCreateWorktree, handleSetSessionDirectory, handleWorktreesAll, type RouteDeps } from '../src/routes.ts'
import { ROUTE_EXISTS, ROUTE_REMOVE, ROUTE_SESSION_CWD } from '../src/wire.ts'
import { CardForm, type SectionValue } from '../src/client/card-form.ts'
import { apply } from '../src/client/index.ts'
import {
  collectWorktreeOwnership,
  hasForgeManagedWorktree,
  isPathWithinWorktree,
  isSessionSwitchedWorktree,
  resolveEffectiveSessionPath,
  selectSessionDirectory,
} from '../src/client/session-directory.ts'
import type { BranchChipInjected } from '../src/client/slots.ts'

describe('generateRandomBranchName', () => {
  it('appends a 4-hex suffix to normal and slash branches', () => {
    expect(generateRandomBranchName('main', undefined, () => 'a3f9')).toBe('main-a3f9')
    expect(generateRandomBranchName('feat/login', undefined, () => '00be')).toBe('feat/login-00be')
  })

  it('normalizes detached HEAD and invalid stems to wt-<4hex>', () => {
    expect(generateRandomBranchName('HEAD', undefined, () => '12ab')).toBe('wt-12ab')
    expect(generateRandomBranchName('   ', undefined, () => '12ab')).toBe('wt-12ab')
    expect(generateRandomBranchName('bad..name', undefined, () => '12ab')).toBe('wt-12ab')
  })

  it('avoids collisions via retry and falls back to numeric suffix if exhausted', () => {
    const seq = ['aaaa', 'bbbb']
    let i = 0
    const next = () => seq[i++] ?? 'cccc'
    expect(generateRandomBranchName('main', name => name === 'main-aaaa', next)).toBe('main-bbbb')
    expect(generateRandomBranchName('main', name => !name.endsWith('-2'), () => 'dead')).toBe('main-dead-2')
  })
})

describe('randomCutoutBranchName & handleCreateWorktree(random: true)', () => {
  it('strips remote prefix and avoids both local branches and taken folders', async () => {
    const exec: Exec = async (_cmd, args) => {
      if (args[0] === 'for-each-ref' && args[1] === 'refs/heads') {
        return { code: 0, stdout: 'main\nfeat/x-a1b2\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref' && args[1] === 'refs/remotes/origin/feat/x') {
        return { code: 0, stdout: 'origin/feat/x\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    const seq = ['a1b2', 'c3d4', 'e5f6']
    let i = 0
    const name = await randomCutoutBranchName(
      exec,
      '/repo',
      'origin/feat/x',
      candidate => candidate === 'feat/x-c3d4',
      () => seq[i++] ?? 'ffff',
    )
    expect(name).toBe('feat/x-e5f6')
  })

  it('creates a random cutout branch when cutout=true and random=true', async () => {
    const repo = resolve('/repo')
    const gitCalls: Array<readonly string[]> = []
    const exec: Exec = async (_cmd, args) => {
      gitCalls.push(args)
      if (args[0] === 'rev-parse') return { code: 0, stdout: `${repo}\n.git\nmain\n`, stderr: '' }
      if (args[0] === 'for-each-ref' && args[1] === 'refs/heads') return { code: 0, stdout: 'main\n', stderr: '' }
      if (args[0] === 'for-each-ref' && args[1] === 'refs/remotes') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'worktree' && args[1] === 'list') return { code: 0, stdout: `worktree ${repo}\nbranch refs/heads/main\n\n`, stderr: '' }
      if (args[0] === 'show-ref' && args[2] === 'refs/heads/main') return { code: 0, stdout: 'abc\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const deps: RouteDeps = {
      exec,
      sectionRootDir: () => undefined,
      sectionFetchBeforeCreate: () => false,
      home: () => '/home/u',
      envHome: () => undefined,
      dirExists: p => p === repo,
      excludeSeams: { readFile: async () => '/.dsh/gitworktree/\n', appendFile: async () => {}, mkdir: async () => {} },
      mkdirRecursive: async () => {},
      randomHex: () => '7f3a',
    }
    const outcome = await handleCreateWorktree(deps, {
      repoPath: repo,
      branch: 'main',
      cutout: true,
      random: true,
    })
    const expectedPath = join(repo, '.dsh', 'gitworktree', 'main-7f3a')
    expect(outcome).toEqual({ status: 200, body: { path: expectedPath, created: true } })
    expect(gitCalls.some(args => args[0] === 'worktree' && args[1] === 'add' && args[3] === '-b' && args[4] === 'main-7f3a')).toBe(true)
  })
})

describe('handleSetSessionDirectory', () => {
  const baseDeps = (over: Partial<RouteDeps> = {}): RouteDeps => ({
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    sectionRootDir: () => undefined,
    sectionFetchBeforeCreate: () => false,
    home: () => '/home/u',
    envHome: () => undefined,
    statDirectory: async () => true,
    ...over,
  })

  it('returns 501 when the host does not expose workingDirectory switching', async () => {
    const res = await handleSetSessionDirectory(baseDeps(), { sessionId: 's-1', path: '/repo/.dsh/gitworktree/feat' })
    expect(res.status).toBe(501)
  })

  it('validates sessionId, absolute path, and directory existence', async () => {
    const deps = baseDeps({ setSessionDirectory: async (_id, p) => p, statDirectory: async () => false })
    expect((await handleSetSessionDirectory(deps, { sessionId: '   ', path: '/a' })).status).toBe(400)
    expect((await handleSetSessionDirectory(deps, { sessionId: 's-1', path: 'relative/dir' })).status).toBe(400)
    expect((await handleSetSessionDirectory(deps, { sessionId: 's-1', path: '/missing/dir' })).status).toBe(400)
  })

  it('commits the canonical directory and propagates custom httpStatus errors', async () => {
    const calls: Array<[string, string]> = []
    const deps = baseDeps({
      setSessionDirectory: async (id, path) => {
        calls.push([id, path])
        return path
      },
    })
    const ok = await handleSetSessionDirectory(deps, { sessionId: 's-1', path: '/repo/.dsh/gitworktree/feat' })
    expect(ok).toEqual({ status: 200, body: { sessionId: 's-1', path: resolve('/repo/.dsh/gitworktree/feat') } })
    expect(calls).toEqual([['s-1', resolve('/repo/.dsh/gitworktree/feat')]])

    const notFoundDeps = baseDeps({
      setSessionDirectory: async () => {
        throw Object.assign(new Error('session missing'), { httpStatus: 404 })
      },
    })
    expect(await handleSetSessionDirectory(notFoundDeps, { sessionId: 's-gone', path: '/repo/.dsh/gitworktree/feat' }))
      .toEqual({ status: 404, body: { error: 'session missing' } })
  })
})

describe('session-directory projection & dual-mode ownership', () => {
  it('prefers projectionsBySession, then projectionValues, then header cwd', () => {
    const state = {
      byId: {
        s1: { cwd: '/repo', projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/a' } },
        s2: { cwd: '/repo', projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/b' } },
        s3: { cwd: '/repo' },
      },
      projectionsBySession: {
        s1: { values: { workingDirectory: '/repo/.dsh/gitworktree/live' } },
      },
    }
    expect(selectSessionDirectory(state, 's1')).toBe('/repo/.dsh/gitworktree/live')
    expect(selectSessionDirectory(state, 's2')).toBe('/repo/.dsh/gitworktree/b')
    expect(selectSessionDirectory(state, 's3')).toBe('/repo')
    expect(selectSessionDirectory(state, 'missing')).toBeUndefined()
  })

  it('reads live binding projection before list snapshot in resolveEffectiveSessionPath', () => {
    const resolved = resolveEffectiveSessionPath(
      {
        list: { getSnapshot: () => ({ byId: { s1: { cwd: '/repo' } } }) },
        binding: () => ({
          session: {
            projections: {
              faceOf: () => ({ getSnapshot: () => '/repo/.dsh/gitworktree/bound' }),
            },
          },
        }),
      },
      's1',
      [{ workspaceId: 'ws-main', path: '/repo', sessionIds: ['s1'] }],
    )
    expect(resolved).toBe('/repo/.dsh/gitworktree/bound')
  })

  it('guards isPathWithinWorktree against sibling prefix collisions', () => {
    expect(isPathWithinWorktree('/repo/.dsh/gitworktree/feat', '/repo/.dsh/gitworktree/feat')).toBe(true)
    expect(isPathWithinWorktree('/repo/.dsh/gitworktree/feat/sub', '/repo/.dsh/gitworktree/feat')).toBe(true)
    expect(isPathWithinWorktree('/repo/.dsh/gitworktree/feat-2', '/repo/.dsh/gitworktree/feat')).toBe(false)
  })

  it('never returns parent workspaceId or main-branch sessions in shared-workspace mode', () => {
    const workspaces = [
      { workspaceId: 'ws-main', path: '/repo', sessionIds: ['s-main', 's-wt-idle', 's-wt-run', 's-wt-blank'] },
    ]
    const sessionsState = {
      byId: {
        's-main': { cwd: '/repo', running: true, blank: false, updatedAt: 999 },
        's-wt-idle': { cwd: '/repo', running: false, blank: false, updatedAt: 200, projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/feat' } },
        's-wt-run': { cwd: '/repo', running: true, blank: false, updatedAt: 300, projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/feat/pkg' } },
        's-wt-blank': { cwd: '/repo', running: false, blank: true, updatedAt: 400, projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/feat' } },
      },
    }
    const owned = collectWorktreeOwnership('/repo/.dsh/gitworktree/feat', workspaces, sessionsState, [])
    expect(owned.workspaceId).toBeUndefined()
    expect(owned.running).toBe(true)
    expect(owned.archiveIds.sort()).toEqual(['s-wt-idle', 's-wt-run'])
    expect(owned.activity).toBe(300)
  })

  it('distinguishes session-switched worktrees from standalone worktree workspaces for sidebar badges', () => {
    const workspaces = [
      { workspaceId: 'ws-main', path: '/repo', sessionIds: ['s-shared-wt', 's-main'] },
      { workspaceId: 'ws-standalone', path: '/repo/.dsh/gitworktree/feat-a', sessionIds: ['s-standalone', 's-standalone-sub'] },
    ]
    const isLinked = (p: string) => p.includes('.dsh/gitworktree/')
    // Shared-workspace session switched into a linked worktree -> show session badge & hover.
    expect(isSessionSwitchedWorktree('s-shared-wt', '/repo/.dsh/gitworktree/feat-b', workspaces, isLinked)).toBe(true)
    // Main-branch session staying in main workspace -> not switched.
    expect(isSessionSwitchedWorktree('s-main', '/repo', workspaces, isLinked)).toBe(false)
    // Sessions under a standalone worktree Workspace -> workspace owns the identity, skip session badge/hover.
    expect(isSessionSwitchedWorktree('s-standalone', '/repo/.dsh/gitworktree/feat-a', workspaces, isLinked)).toBe(false)
    expect(isSessionSwitchedWorktree('s-standalone-sub', '/repo/.dsh/gitworktree/feat-a/packages/app', workspaces, isLinked)).toBe(false)
  })

  it('detects official forgeWorktree from both projectionsBySession and byId.projectionValues', () => {
    const state = {
      byId: {
        's-proj': { cwd: '/repo' },
        's-summary': { cwd: '/repo', projectionValues: { forgeWorktree: { path: '/repo/.agents/worktrees/x' } } },
        's-plugin': { cwd: '/repo', projectionValues: { forgeWorktree: null } },
      },
      projectionsBySession: {
        's-proj': { values: { forgeWorktree: { path: '/repo/.agents/worktrees/y' } } },
      },
    }
    expect(hasForgeManagedWorktree(state, 's-proj')).toBe(true)
    expect(hasForgeManagedWorktree(state, 's-summary')).toBe(true)
    expect(hasForgeManagedWorktree(state, 's-plugin')).toBe(false)
  })
})

describe('CardForm new switches', () => {
  it('defaults hideOfficialWorktreeEntry on and switchSessionDirectory off and persists flips', async () => {
    const writes: Array<[string, unknown]> = []
    let value: SectionValue = {}
    const listeners = new Set<() => void>()
    const scope: ConfigForm<SectionValue> = {
      getSnapshot: () => ({ status: 'ready', value, base: {}, user: undefined, revision: 1, writable: true, mode: 'host' }) as ConfigFormSnapshot<SectionValue>,
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      mutate: async () => true,
      set: async (field, next) => {
        writes.push([field, next])
        value = { ...value, [field]: next }
        for (const fn of listeners) fn()
        return true
      },
      unset: async () => true,
    }
    const form = new CardForm(scope)
    expect(form.bind().getSnapshot()).toMatchObject({
      hideOfficialWorktreeEntry: true,
      switchSessionDirectory: false,
    })
    await form.actions().setHideOfficialWorktreeEntry(false)
    await form.actions().setSwitchSessionDirectory(true)
    expect(writes).toEqual([
      ['hideOfficialWorktreeEntry', false],
      ['switchSessionDirectory', true],
    ])
    expect(form.bind().getSnapshot()).toMatchObject({
      hideOfficialWorktreeEntry: false,
      switchSessionDirectory: true,
    })
  })
})

describe('client apply: official entry override & shared-workspace mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeClientCtx() {
    const registered: Array<{ options: Record<string, unknown>; component: unknown; disposed: boolean }> = []
    const createdWorkspaces: Array<{ path: string }> = []
    const startedWorkspaces: Array<string | undefined> = []
    const openedSessions: string[] = []
    const createdSessions: Array<Record<string, unknown>> = []
    const refreshedProjections: string[] = []
    const archiveCalls: string[] = []
    const deletedWorkspaces: string[] = []
    let formValue: SectionValue = {}
    const formListeners = new Set<() => void>()
    const workspaceItems: Array<{ workspaceId: string; path: string; sessionIds: string[] }> = []
    const sessionSummaries: Record<string, { cwd?: string; running: boolean; blank: boolean; updatedAt: number; projectionValues?: Record<string, unknown> }> = {}

    const ctx = {
      locale: { register: () => () => {} },
      effect: (fn: () => unknown) => { fn(); return () => {} },
      remote: { $host: { home: '/home/u', isLoopback: true } },
      workspaces: {
        create: async (input: { path: string }) => {
          createdWorkspaces.push(input)
          const ws = { workspaceId: `ws-${createdWorkspaces.length}`, path: input.path, sessionIds: [] as string[] }
          workspaceItems.push(ws)
          return ws
        },
        archiveSession: async (sessionId: string) => { archiveCalls.push(sessionId) },
        delete: async (workspaceId: string) => { deletedWorkspaces.push(workspaceId) },
        list: {
          getSnapshot: () => ({ items: workspaceItems, archivedSessionIds: [] as string[] }),
        },
      },
      sessions: {
        create: async (opts: Record<string, unknown>) => {
          createdSessions.push(opts)
          return `s-new-${createdSessions.length}`
        },
        refreshProjections: async (sessionId: string) => { refreshedProjections.push(sessionId) },
        list: {
          getSnapshot: () => ({ byId: sessionSummaries }),
        },
      },
      uiWorkspace: {
        startSession: (workspaceId?: string) => { startedWorkspaces.push(workspaceId) },
        openSession: (sessionId: string) => { openedSessions.push(sessionId) },
      },
      slots: {
        inject: (_name: string, factory: () => unknown) => {
          const disposer = factory()
          return () => { if (typeof disposer === 'function') disposer() }
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          const entry = { options, component, disposed: false }
          registered.push(entry)
          return () => { entry.disposed = true }
        },
      },
      configForms: {
        get: () => ({
          getSnapshot: () => ({ status: 'ready', value: formValue, user: undefined, writable: true }),
          subscribe: (fn: () => void) => { formListeners.add(fn); return () => { formListeners.delete(fn) } },
          set: async () => true,
          unset: async () => true,
        }),
        describe: () => ({
          getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'git-worktree' }], writable: true, hasDocument: true } }),
          subscribe: () => () => {},
          ensure: async () => {},
        }),
      },
    }

    const setFormValue = (next: SectionValue) => {
      formValue = next
      for (const fn of formListeners) fn()
    }

    return {
      ctx,
      registered,
      createdWorkspaces,
      startedWorkspaces,
      openedSessions,
      createdSessions,
      refreshedProjections,
      archiveCalls,
      deletedWorkspaces,
      workspaceItems,
      sessionSummaries,
      setFormValue,
    }
  }

  it('shadows official conversation.hero.options forge-panel.worktree by default and releases when toggled off', () => {
    const h = makeClientCtx()
    apply(h.ctx as never)
    const activeOverrides = () => h.registered.filter(
      r => !r.disposed && r.options.name === 'conversation.hero.options' && r.options.id === 'forge-panel.worktree',
    )
    expect(activeOverrides()).toHaveLength(1)
    expect(activeOverrides()[0]?.options.priority).toBe(-10)
    expect(typeof activeOverrides()[0]?.options.inject).toBe('function')

    h.setFormValue({ hideOfficialWorktreeEntry: false })
    expect(activeOverrides()).toHaveLength(0)

    h.setFormValue({ hideOfficialWorktreeEntry: true })
    expect(activeOverrides()).toHaveLength(1)
  })

  it('cancels pending official forge worktree requests via optional remote.forgePanel injection before switching cwd', async () => {
    const h = makeClientCtx()
    h.setFormValue({ switchSessionDirectory: true })
    const cancelled: string[] = []
    const strictCtx = Object.assign(h.ctx, {
      inject: (deps: readonly string[], cb: (scope: unknown) => void) => {
        if (deps.includes('remote.forgePanel')) {
          cb({
            remote: {
              forgePanel: {
                cancelWorktree: async (sessionId: string) => { cancelled.push(sessionId) },
              },
            },
            effect: (fn: () => unknown) => { fn(); return () => {} },
          })
        }
      },
    })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ sessionId: 's-blank', path: '/repo/.dsh/gitworktree/feat', facts: {} }), { status: 200 }))
    apply(strictCtx as never)
    const chipEntry = h.registered.find(r => r.options.name === 'conversation.input.left')!
    const face = (chipEntry.options.inject as () => BranchChipInjected)()

    await face.adoptWorktree('/repo/.dsh/gitworktree/feat', { reuseBlankSessionId: 's-blank', repoRoot: '/repo' })

    expect(cancelled).toEqual(['s-blank'])
  })

  it('switches the current blank session directory in place when switchSessionDirectory is enabled', async () => {
    const h = makeClientCtx()
    h.setFormValue({ switchSessionDirectory: true })
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
      return new Response(JSON.stringify({ sessionId: 's-blank', path: '/repo/.dsh/gitworktree/feat', facts: {} }), { status: 200 })
    })
    apply(h.ctx as never)
    const chipEntry = h.registered.find(r => r.options.name === 'conversation.input.left')!
    const face = (chipEntry.options.inject as () => BranchChipInjected)()

    await face.adoptWorktree('/repo/.dsh/gitworktree/feat', { reuseBlankSessionId: 's-blank', repoRoot: '/repo' })

    expect(calls.some(c => c.url === ROUTE_SESSION_CWD && (c.body as { sessionId: string }).sessionId === 's-blank')).toBe(true)
    expect(h.createdWorkspaces).toEqual([])
    expect(h.createdSessions).toEqual([])
    expect(h.refreshedProjections).toContain('s-blank')
  })

  it('creates a fresh session under the parent repository workspace when adopting outside a blank session', async () => {
    const h = makeClientCtx()
    h.workspaceItems.push({ workspaceId: 'ws-parent', path: '/repo', sessionIds: ['s-existing'] })
    h.setFormValue({ switchSessionDirectory: true })
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
      return new Response(JSON.stringify({ sessionId: 's-new-1', path: '/repo/.dsh/gitworktree/feat', facts: {} }), { status: 200 })
    })
    apply(h.ctx as never)
    const chipEntry = h.registered.find(r => r.options.name === 'conversation.input.left')!
    const face = (chipEntry.options.inject as () => BranchChipInjected)()

    await face.adoptWorktree('/repo/.dsh/gitworktree/feat', { repoRoot: '/repo' })

    expect(h.createdWorkspaces).toEqual([])
    expect(h.createdSessions).toEqual([{ workspaceId: 'ws-parent' }])
    expect(calls.some(c => c.url === ROUTE_SESSION_CWD && (c.body as { sessionId: string }).sessionId === 's-new-1')).toBe(true)
    expect(h.openedSessions).toEqual(['s-new-1'])
  })

  it('reuses an existing unarchived blank session already targeting the same worktree without creating duplicates', async () => {
    const h = makeClientCtx()
    h.workspaceItems.push({
      workspaceId: 'ws-parent',
      path: '/repo',
      sessionIds: ['s-main-blank', 's-other-wt-blank', 's-same-wt-started', 's-same-wt-blank'],
    })
    h.sessionSummaries['s-main-blank'] = { cwd: '/repo', running: false, blank: true, updatedAt: 1 }
    h.sessionSummaries['s-other-wt-blank'] = {
      cwd: '/repo',
      running: false,
      blank: true,
      updatedAt: 2,
      projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/other' },
    }
    h.sessionSummaries['s-same-wt-started'] = {
      cwd: '/repo',
      running: false,
      blank: false,
      updatedAt: 3,
      projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/feat' },
    }
    h.sessionSummaries['s-same-wt-blank'] = {
      cwd: '/repo',
      running: false,
      blank: true,
      updatedAt: 4,
      projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/feat' },
    }
    h.setFormValue({ switchSessionDirectory: true })
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ facts: {} }), { status: 200 })
    })
    apply(h.ctx as never)
    const chipEntry = h.registered.find(r => r.options.name === 'conversation.input.left')!
    const face = (chipEntry.options.inject as () => BranchChipInjected)()

    await face.adoptWorktree('/repo/.dsh/gitworktree/feat', { repoRoot: '/repo' })

    expect(h.createdWorkspaces).toEqual([])
    expect(h.createdSessions).toEqual([])
    expect(calls).not.toContain(ROUTE_SESSION_CWD)
    expect(h.openedSessions).toEqual(['s-same-wt-blank'])
  })

  it('archives only sessions inside the removed worktree and never deletes the parent repository workspace', async () => {
    const h = makeClientCtx()
    h.workspaceItems.push({ workspaceId: 'ws-parent', path: '/repo', sessionIds: ['s-main', 's-wt'] })
    h.sessionSummaries['s-main'] = { cwd: '/repo', running: false, blank: false, updatedAt: 10 }
    h.sessionSummaries['s-wt'] = {
      cwd: '/repo',
      running: false,
      blank: false,
      updatedAt: 20,
      projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/feat' },
    }
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === ROUTE_REMOVE) return new Response(JSON.stringify({ path: '/repo/.dsh/gitworktree/feat', pruned: false }), { status: 200 })
      if (url === ROUTE_EXISTS) return new Response(JSON.stringify({ exists: {} }), { status: 200 })
      return new Response(JSON.stringify({ facts: {} }), { status: 200 })
    })
    apply(h.ctx as never)
    const chipEntry = h.registered.find(r => r.options.name === 'conversation.input.left')!
    const face = (chipEntry.options.inject as () => BranchChipInjected)()

    await face.removeWorktree('/repo/.dsh/gitworktree/feat', false)

    expect(h.archiveCalls).toEqual(['s-wt'])
    expect(h.deletedWorkspaces).toEqual([])
  })
})

describe('worktree base branch metadata', () => {
  it('persists and reads baseBranch inside the linked worktree gitdir without dirtying the working tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-wt-base-'))
    try {
      const wtDir = join(root, 'wt')
      const gitDir = join(root, 'repo', '.git', 'worktrees', 'wt')
      await mkdir(wtDir, { recursive: true })
      await mkdir(gitDir, { recursive: true })
      await writeFile(join(wtDir, '.git'), `gitdir: ${gitDir}\n`, 'utf8')

      expect(await readWorktreeBaseBranch(wtDir)).toBeUndefined()
      await writeWorktreeBaseBranch(wtDir, 'feature/session-worktree-mode')
      expect(await readWorktreeBaseBranch(wtDir)).toBe('feature/session-worktree-mode')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('official worktree manager toggle, binding mode badges, and Rule A adoption', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scans <repo>/.agents/worktrees only when manageOfficialWorktrees is enabled', async () => {
    const repo = resolve('/repo')
    const officialDir = join(repo, '.agents', 'worktrees')
    const officialWt = join(officialDir, 'dsh-1234')
    const exec: Exec = async (_cmd, _args, opts) => {
      if (opts.cwd === repo) return { code: 0, stdout: `${repo}\n.git\nmain\n`, stderr: '' }
      if (opts.cwd === officialWt) return { code: 0, stdout: `${officialWt}\n${join(repo, '.git')}\ndsh-1234\n`, stderr: '' }
      return { code: 1, stdout: '', stderr: 'not git' }
    }
    const baseDeps = (manageOfficial: boolean): RouteDeps => ({
      exec,
      sectionRootDir: () => undefined,
      sectionFetchBeforeCreate: () => false,
      sectionManageOfficialWorktrees: () => manageOfficial,
      home: () => '/home/u',
      envHome: () => undefined,
      statDirectory: async () => false,
      listDir: async (dir) => (dir === officialDir ? ['dsh-1234'] : []),
    })

    const off = await handleWorktreesAll(baseDeps(false), { workspaces: [repo] })
    expect(off.status).toBe(200)
    expect((off.body as { worktrees: unknown[] }).worktrees).toEqual([])

    const on = await handleWorktreesAll(baseDeps(true), { workspaces: [repo] })
    expect(on.status).toBe(200)
    expect((on.body as { worktrees: unknown[] }).worktrees).toEqual([
      { path: officialWt, repoRoot: repo, repoName: 'repo', branch: 'dsh-1234', source: 'official' },
    ])
  })

  it('classifies worktree binding mode as standalone, session, or none', () => {
    const workspaces = [
      { workspaceId: 'ws-main', path: '/repo', sessionIds: ['s-session'] },
      { workspaceId: 'ws-standalone', path: '/repo/.dsh/gitworktree/old', sessionIds: [] },
    ]
    const sessions = {
      byId: {
        's-session': {
          cwd: '/repo',
          blank: false,
          running: false,
          updatedAt: 50,
          projectionValues: { workingDirectory: '/repo/.dsh/gitworktree/shared' },
        },
      },
    }
    expect(collectWorktreeOwnership('/repo/.dsh/gitworktree/old', workspaces, sessions, []).mode).toBe('standalone')
    expect(collectWorktreeOwnership('/repo/.dsh/gitworktree/shared', workspaces, sessions, []).mode).toBe('session')
    expect(collectWorktreeOwnership('/repo/.dsh/gitworktree/unbound', workspaces, sessions, []).mode).toBe('none')
  })

  it('opens an existing standalone workspace directly (Rule A) and never calls session-cwd when hopping back to main repo', async () => {
    const started: string[] = []
    const fetchUrls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetchUrls.push(url)
      return new Response(JSON.stringify({ facts: {} }), { status: 200 })
    })
    const form: ConfigForm<SectionValue> = {
      getSnapshot: () => ({ status: 'ready', writable: true, value: { switchSessionDirectory: true } }),
      subscribe: () => () => {},
      ensure: async () => {},
      setField: async () => {},
      unsetField: async () => {},
    }
    const registered: Array<{ name: string; inject?: () => unknown }> = []
    const ctx = {
      effect: () => () => {},
      locale: { register: () => () => {}, bind: () => (k: string) => k },
      configForms: {
        get: () => form,
        describe: () => ({ getSnapshot: () => ({ status: 'ready', view: { namespaces: [] } }), subscribe: () => () => {}, ensure: async () => {} }),
      },
      workspaces: {
        list: {
          getSnapshot: () => ({
            items: [
              { workspaceId: 'ws-main', path: '/repo', sessionIds: ['s-wt'] },
              { workspaceId: 'ws-old', path: '/repo/.dsh/gitworktree/old', sessionIds: [] },
            ],
            archivedSessionIds: [],
          }),
          subscribe: () => () => {},
        },
        create: async ({ path }: { path: string }) => ({ workspaceId: `ws:${path}`, path, sessionIds: [] }),
        archiveSession: async () => {},
        delete: async () => {},
      },
      sessions: {
        list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} },
        create: async () => 's-new',
        refreshProjections: async () => {},
      },
      uiWorkspace: {
        startSession: (wsId: string) => { started.push(wsId) },
        openSession: () => {},
      },
      slots: {
        inject: (_name: string, fn: () => (() => void)) => fn(),
        register: (meta: { name: string; inject?: () => unknown }) => { registered.push(meta); return () => {} },
      },
      connection: {},
      remote: {},
    }
    apply(ctx as never)
    const chip = registered.find(r => r.name === 'conversation.input.left')?.inject?.() as BranchChipInjected

    await chip.adoptWorktree('/repo/.dsh/gitworktree/old', { reuseBlankSessionId: 's-main-blank', repoRoot: '/repo' })
    await chip.adoptWorktree('/repo', { repoRoot: '/repo' })

    expect(started).toEqual(['ws-old', 'ws-main'])
    expect(fetchUrls).not.toContain(ROUTE_SESSION_CWD)
  })
})
