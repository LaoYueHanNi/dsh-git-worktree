/**
 * dsh-git-worktree host half. Exposes volatile configuration fields projected
 * through the settings service (the `git-worktree` profile entry in the active
 * dsh profile) and — while a webServer service exists — the HTTP routes the
 * browser half fetches. Config edits persist into the profile patch and take
 * effect live via the loader.
 */

import { homedir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the webServer Context declaration merge into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the settings Context declaration merge (`ctx.settings`).
import type {} from '@deepseek-ai/dsh-settings'
import { DeferredWorktreeCoordinator, type DeferredAgentLike } from './deferred-worktree.js'
import { childProcessExec } from './git.js'
import { isForgeServiceLike, type ForgeServiceLike } from './pr.js'
import {
  executeCreateWorktree, handleArmDeferredWorktree, handleCreateBranch, handleCreateWorktree, handleDeferredWorktreeAction, handleDeleteBranch, handleEnsureDirectory, handleFetch, handleGetDeferredWorktree, handleGroupWorktrees, handleHead, handleInspectWorktree, handlePathExists, handlePrCheckout, handlePrContext, handlePrResolve, handlePush, handlePushPlan, handlePushPreview, handlePurgeDirectory, handleRemoveWorktree, handleRenameBranch, handleSetSessionDirectory, handleStatus, handleSwitch, handleUpdate, handleWorktreesAll,
  type RouteDeps, type RouteLive, type RouteOutcome,
} from './routes.js'
import { validateRootDir } from './settings.js'
import { handleAuthors, handleHistory, handleCommit } from './routes.js'
import { ROUTE_AUTHORS, ROUTE_HISTORY, ROUTE_COMMIT } from './wire.js'
import { streamRoute } from './stream.js'
import { ROUTE_BRANCH, ROUTE_BRANCH_DELETE, ROUTE_BRANCH_RENAME, ROUTE_DEFERRED, ROUTE_DEFERRED_ACTION, ROUTE_DEFERRED_ARM, ROUTE_DEFERRED_EVENTS, ROUTE_ENSURE_DIRECTORY, ROUTE_EXISTS, ROUTE_FETCH, ROUTE_GROUP, ROUTE_HEAD, ROUTE_INSPECT, ROUTE_PR_CHECKOUT, ROUTE_PR_CONTEXT, ROUTE_PR_RESOLVE, ROUTE_PUSH, ROUTE_PUSH_PLAN, ROUTE_PUSH_PREVIEW, ROUTE_PURGE, ROUTE_REMOVE, ROUTE_SESSION_CWD, ROUTE_STATUS, ROUTE_SWITCH, ROUTE_UPDATE, ROUTE_WORKTREE, ROUTE_WORKTREES_ALL } from './wire.js'

export const name = 'dsh-git-worktree'

export const inject = []

/** Largest accepted request body (bytes) — these payloads are a few strings. */
const BODY_LIMIT = 64 * 1024

function readVolatile<T>(value: Volatile<T> | T | undefined): T | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'object' && value !== null && 'get' in value && typeof (value as { get: unknown }).get === 'function') {
    return (value as Volatile<T>).get() as T
  }
  return value as T
}

export interface Config {
  /** Worktree storage root; defaults to `$DSH_HOME/gitworktree` (`~/.dsh/gitworktree`). */
  rootDir?: Volatile<string | undefined> | string
  /** Sidebar git grouping on/off; absent = on (the composition-entry layer's default). */
  groupSidebar?: Volatile<boolean> | boolean
  /** Fetch every remote before creating a worktree; absent = off. A failed
   * fetch never blocks the creation (see the /worktree route). */
  fetchBeforeCreate?: Volatile<boolean> | boolean
  /** Open the commit graph when the composer branch button is clicked; absent = off. */
  openGraphByDefault?: Volatile<boolean> | boolean
  /** Prune stale worktrees lazily after each creation; absent = off. */
  autoPruneWorktrees?: Volatile<boolean> | boolean
  /** Global cap the lazy prune trims down to (valid git worktrees only);
   * absent = 30. */
  keepWorktrees?: Volatile<number> | number
  /** Post-create configuration files to copy when .worktreeinclude is absent;
   * absent = none. */
  postCreateCopyFiles?: Volatile<string[]> | string[]
  /** Hide the official top-right new-worktree control in blank sessions; absent = on. */
  hideOfficialWorktreeEntry?: Volatile<boolean> | boolean
  /** Open worktrees by switching the session working directory under the parent
   * repository workspace instead of creating a standalone workspace; absent = off. */
  switchSessionDirectory?: Volatile<boolean> | boolean
  /** Include official `<repo>/.agents/worktrees` worktrees in the worktree manager; absent = off. */
  manageOfficialWorktrees?: Volatile<boolean> | boolean
}

/** The shipped prune cap (whole storage root, valid git worktrees only). */
export const KEEP_WORKTREES_DEFAULT = 30

/**
 * Cordis resolves the composition entry's config through this schema before
 * `apply` runs. In dsh 0.1.7+, fields marked with `.volatile()` are projected
 * by the settings service into live configuration forms.
 */
export const Config: z = z.object({
  rootDir: z.string().volatile(),
  groupSidebar: z.boolean().default(true).volatile(),
  fetchBeforeCreate: z.boolean().default(false).volatile(),
  openGraphByDefault: z.boolean().default(false).volatile(),
  autoPruneWorktrees: z.boolean().default(false).volatile(),
  keepWorktrees: z.number().default(KEEP_WORKTREES_DEFAULT).volatile(),
  postCreateCopyFiles: z.array(z.string()).default([]).volatile(),
  hideOfficialWorktreeEntry: z.boolean().default(true).volatile(),
  switchSessionDirectory: z.boolean().default(false).volatile(),
  manageOfficialWorktrees: z.boolean().default(false).volatile(),
})

/** Reject stale or misspelled config keys before defaults can hide them. */
export function validateConfig(config: Config): void {
  const unknown = Object.keys(config).find(key =>
    key !== 'rootDir' && key !== 'groupSidebar' && key !== 'fetchBeforeCreate' && key !== 'openGraphByDefault' && key !== 'autoPruneWorktrees' && key !== 'keepWorktrees' && key !== 'postCreateCopyFiles' && key !== 'hideOfficialWorktreeEntry' && key !== 'switchSessionDirectory' && key !== 'manageOfficialWorktrees')
  if (unknown !== undefined) {
    throw new Error(`GitWorktreeConfig: unknown key "${unknown}"`)
  }
  const root = readVolatile(config.rootDir)
  if (root !== undefined && (typeof root !== 'string' || root.length === 0)) {
    throw new Error('GitWorktreeConfig: "rootDir" must be a non-empty string')
  }
  const groupSidebar = readVolatile(config.groupSidebar)
  if (groupSidebar !== undefined && typeof groupSidebar !== 'boolean') {
    throw new Error('GitWorktreeConfig: "groupSidebar" must be a boolean')
  }
  const fetchBeforeCreate = readVolatile(config.fetchBeforeCreate)
  if (fetchBeforeCreate !== undefined && typeof fetchBeforeCreate !== 'boolean') {
    throw new Error('GitWorktreeConfig: "fetchBeforeCreate" must be a boolean')
  }
  const openGraphByDefault = readVolatile(config.openGraphByDefault)
  if (openGraphByDefault !== undefined && typeof openGraphByDefault !== 'boolean') {
    throw new Error('GitWorktreeConfig: "openGraphByDefault" must be a boolean')
  }
  const autoPruneWorktrees = readVolatile(config.autoPruneWorktrees)
  if (autoPruneWorktrees !== undefined && typeof autoPruneWorktrees !== 'boolean') {
    throw new Error('GitWorktreeConfig: "autoPruneWorktrees" must be a boolean')
  }
  const hideOfficialWorktreeEntry = readVolatile(config.hideOfficialWorktreeEntry)
  if (hideOfficialWorktreeEntry !== undefined && typeof hideOfficialWorktreeEntry !== 'boolean') {
    throw new Error('GitWorktreeConfig: "hideOfficialWorktreeEntry" must be a boolean')
  }
  const switchSessionDirectory = readVolatile(config.switchSessionDirectory)
  if (switchSessionDirectory !== undefined && typeof switchSessionDirectory !== 'boolean') {
    throw new Error('GitWorktreeConfig: "switchSessionDirectory" must be a boolean')
  }
  const manageOfficialWorktrees = readVolatile(config.manageOfficialWorktrees)
  if (manageOfficialWorktrees !== undefined && typeof manageOfficialWorktrees !== 'boolean') {
    throw new Error('GitWorktreeConfig: "manageOfficialWorktrees" must be a boolean')
  }
  const postCreateCopyFiles = readVolatile(config.postCreateCopyFiles)
  if (postCreateCopyFiles !== undefined) {
    if (!Array.isArray(postCreateCopyFiles) || !postCreateCopyFiles.every(item => typeof item === 'string')) {
      throw new Error('GitWorktreeConfig: "postCreateCopyFiles" must be an array of strings')
    }
  }
  validateKeepWorktrees(readVolatile(config.keepWorktrees))
  validateRootDir(root)
}

/**
 * The prune cap must be an integer >= 1: 0 would read as "create then
 * immediately self-delete" (the fresh worktree is excluded, but every other
 * one dies on the next creation), a fraction cannot count directories.
 * Absent = the shipped default, which passes.
 */
export function validateKeepWorktrees(value: number | undefined): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('GitWorktreeConfig: "keepWorktrees" must be an integer >= 1')
  }
}

/** The settings namespace this plugin serves; its browser card spells the same string. */
export const GIT_WORKTREE_NS = 'git-worktree'

/** The settings-facing subset of the config: the worktree storage root, the
 * sidebar grouping switch, and the create/prune behavior switches. */
export interface SectionConfig {
  /** Worktree storage root; absent/blank selects `$DSH_HOME/gitworktree`. */
  rootDir?: string
  /** Whether the sidebar groups same-repository workspaces; absent = on. */
  groupSidebar?: boolean
  /** Fetch every remote before creating a worktree; absent = off. */
  fetchBeforeCreate?: boolean
  /** Open the commit graph from the composer branch button; absent = off. */
  openGraphByDefault?: boolean
  /** Prune stale worktrees lazily after each creation; absent = off. */
  autoPruneWorktrees?: boolean
  /** Global cap the lazy prune trims down to; absent = 30. */
  keepWorktrees?: number
  /** Post-create configuration files to copy when .worktreeinclude is absent. */
  postCreateCopyFiles?: string[]
  /** Hide the official top-right new-worktree control in blank sessions; absent = on. */
  hideOfficialWorktreeEntry?: boolean
  /** Switch session working directory under parent repository workspace instead of creating standalone workspaces; absent = off. */
  switchSessionDirectory?: boolean
  /** Include official `<repo>/.agents/worktrees` worktrees in the worktree manager; absent = off. */
  manageOfficialWorktrees?: boolean
}


/** The section-shaped view of a config: absent keys stay absent
 * (`exactOptionalPropertyTypes`) except the switches, which spell their
 * shipped defaults so a user-layer unset can always fall back to them. */
export function sectionOf(config: Config): SectionConfig {
  const rootDir = readVolatile(config.rootDir)
  const postCreateCopyFiles = readVolatile(config.postCreateCopyFiles)
  const groupSidebar = readVolatile(config.groupSidebar)
  const fetchBeforeCreate = readVolatile(config.fetchBeforeCreate)
  const openGraphByDefault = readVolatile(config.openGraphByDefault)
  const autoPruneWorktrees = readVolatile(config.autoPruneWorktrees)
  const keepWorktrees = readVolatile(config.keepWorktrees)
  const hideOfficialWorktreeEntry = readVolatile(config.hideOfficialWorktreeEntry)
  const switchSessionDirectory = readVolatile(config.switchSessionDirectory)
  const manageOfficialWorktrees = readVolatile(config.manageOfficialWorktrees)
  return {
    ...(rootDir === undefined ? {} : { rootDir }),
    ...(postCreateCopyFiles === undefined ? {} : { postCreateCopyFiles }),
    // The composition layer spells the shipped defaults so a user-layer
    // unset can always fall back to them.
    groupSidebar: groupSidebar ?? true,
    fetchBeforeCreate: fetchBeforeCreate ?? false,
    openGraphByDefault: openGraphByDefault ?? false,
    autoPruneWorktrees: autoPruneWorktrees ?? false,
    keepWorktrees: keepWorktrees ?? KEEP_WORKTREES_DEFAULT,
    hideOfficialWorktreeEntry: hideOfficialWorktreeEntry ?? true,
    switchSessionDirectory: switchSessionDirectory ?? false,
    manageOfficialWorktrees: manageOfficialWorktrees ?? false,
  }
}

interface HostAgentRegistryLike {
  get(sessionId: string): unknown
  resume?: (options: { readonly resumeSessionId: string }) => Promise<{ readonly agent: unknown; readonly dispose?: () => Promise<void> | void }>
}

interface HostWorkingDirectoryLike {
  set(agent: unknown, path: string, signal?: AbortSignal): Promise<string>
}

const isHostAgentRegistryLike = (value: unknown): value is HostAgentRegistryLike =>
  typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'

const isHostWorkingDirectoryLike = (value: unknown): value is HostWorkingDirectoryLike =>
  typeof value === 'object' && value !== null && typeof (value as { set?: unknown }).set === 'function'

function withHttpStatus(message: string, httpStatus: number): Error & { httpStatus: number } {
  return Object.assign(new Error(message), { httpStatus })
}

/**
 * Plugin apply: mount the settings presentation policy and HTTP routes on any
 * webServer that comes and goes.
 * @param ctx - host cordis context.
 * @param config - the composition entry config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  validateConfig(config)

  const currentConfig = (): Config => (ctx.fiber?.config as Config | undefined) ?? config

  let sessionDirectorySetter: ((sessionId: string, path: string) => Promise<string>) | undefined
  let deferredWorktrees: DeferredWorktreeCoordinator | undefined
  let forgeService: ForgeServiceLike | undefined

  const baseDeps = (): RouteDeps => ({
    exec: childProcessExec,
    sectionRootDir: () => readVolatile(currentConfig().rootDir),
    sectionFetchBeforeCreate: () => readVolatile(currentConfig().fetchBeforeCreate),
    sectionPostCreateCopyFiles: () => readVolatile(currentConfig().postCreateCopyFiles),
    sectionManageOfficialWorktrees: () => readVolatile(currentConfig().manageOfficialWorktrees),
    forge: () => forgeService,
    ...(sessionDirectorySetter === undefined ? {} : { setSessionDirectory: sessionDirectorySetter }),
    ...(deferredWorktrees === undefined ? {} : { deferredWorktrees }),
    home: () => homedir(),
    envHome: () => process.env.DSH_HOME,
  })

  if (typeof ctx.inject === 'function') {
    const injectOptional = ctx.inject.bind(ctx) as (
      deps: readonly string[],
      callback: (scope: Context) => void,
    ) => unknown
    injectOptional(['forge'], (forgeCtx) => {
      const candidate = (forgeCtx as unknown as { forge?: unknown }).forge
      if (isForgeServiceLike(candidate)) {
        forgeService = candidate
        forgeCtx.effect(() => () => {
          if (forgeService === candidate) forgeService = undefined
        }, 'git-worktree: optional forge bridge')
      }
    })
    injectOptional(['agents', 'workingDirectory'], (hostCtx) => {
      const agentsCandidate = (hostCtx as unknown as { agents?: unknown }).agents
      const workingDirCandidate = (hostCtx as unknown as { workingDirectory?: unknown }).workingDirectory
      if (!isHostAgentRegistryLike(agentsCandidate) || !isHostWorkingDirectoryLike(workingDirCandidate)) return
      const setter = async (sessionId: string, targetPath: string): Promise<string> => {
        const live = agentsCandidate.get(sessionId)
        if (live !== undefined) {
          return await workingDirCandidate.set(live, targetPath)
        }
        if (typeof agentsCandidate.resume === 'function') {
          const resumed = await agentsCandidate.resume({ resumeSessionId: sessionId })
          try {
            return await workingDirCandidate.set(resumed.agent, targetPath)
          } finally {
            await resumed.dispose?.()
          }
        }
        throw withHttpStatus(`Session "${sessionId}" is not loaded`, 404)
      }
      const coordinator = new DeferredWorktreeCoordinator({
        createWorktree: (spec, onPhase, signal) => executeCreateWorktree(baseDeps(), spec, onPhase, signal),
        setWorkingDirectory: (agent, targetPath, signal) => workingDirCandidate.set(agent, targetPath, signal),
      })
      sessionDirectorySetter = setter
      deferredWorktrees = coordinator

      const listen = (hostCtx as unknown as {
        on?: (event: string, listener: (...args: unknown[]) => unknown) => (() => void)
      }).on?.bind(hostCtx)
      const unsubInbox = listen?.('agent/inbox/inserted', (payload: unknown) => {
        const record = payload as { readonly agent?: DeferredAgentLike; readonly message?: { readonly id?: string } } | undefined
        if (record?.agent !== undefined) coordinator.onInboxInserted(record.agent, record.message)
      })
      const unsubPreStep = listen?.('agent/pre-step', async (payload: unknown, next: unknown) => {
        const record = payload as { readonly agent?: DeferredAgentLike; readonly step?: number; readonly signal?: AbortSignal } | undefined
        const callNext = typeof next === 'function' ? next as () => Promise<unknown> : async () => undefined
        if (record?.agent !== undefined && typeof record.step === 'number') {
          const created = await coordinator.onPreStep(record.agent, record.step, record.signal)
          if (!created) return await callNext()
          const decision = await callNext() as { readonly kind?: string; readonly messages?: readonly unknown[] } | undefined
          if (decision !== undefined && decision.kind !== 'reject' && Array.isArray(decision.messages) && decision.messages.length > 0) {
            const nextStep = record.agent.inbox?.nextStep ?? []
            const notices = nextStep.filter(item => item.source?.kind === 'working-directory')
            if (notices.length > 0) {
              for (const notice of notices) record.agent.inbox?.remove?.(notice.id)
              return { ...decision, messages: [...decision.messages, ...notices] }
            }
          }
          return decision
        }
        return await callNext()
      })

      hostCtx.effect(() => async () => {
        unsubInbox?.()
        unsubPreStep?.()
        if (sessionDirectorySetter === setter) sessionDirectorySetter = undefined
        if (deferredWorktrees === coordinator) deferredWorktrees = undefined
        await coordinator.dispose()
      }, 'git-worktree: optional workingDirectory & deferred worktree bridge')
    })
  }

  const deps = (): RouteDeps => baseDeps()

  // In dsh 0.1.7+, the settings service projects volatile Config fields into forms.
  // We configure auto: false to inform the host that this plugin provides its own
  // dedicated configuration card (via `plugins.bundle.config`).
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), 'git-worktree: settings presentation policy')
  })

  ctx.inject(['webServer'], (webCtx) => {
    /** Send one outcome as JSON; no-store because repo facts are point-in-time. */
    const send = (res: ServerResponse, outcome: RouteOutcome): void => {
      res.writeHead(outcome.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(outcome.body))
    }

    /** Read and JSON-parse one bounded request body. */
    const readJson = (req: IncomingMessage): Promise<unknown> => new Promise((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > BODY_LIMIT) {
          req.destroy()
          rejectPromise(new Error('request body too large'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (chunks.length === 0) {
          resolvePromise({})
          return
        }
        try {
          resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          rejectPromise(new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
      req.on('error', rejectPromise)
    })

    /** One exact POST route: bounded JSON body in, one RouteOutcome out. A
     * body-level failure (too large, invalid JSON) answers 400 and leaves
     * the server alive; handler outcomes carry their own status codes. */
    const postRoute = (path: string, label: string, handle: (deps: RouteDeps, body: unknown) => Promise<RouteOutcome>): void => {
      webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path, handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          send(res, await handle(deps(), await readJson(req)))
        } catch (error) {
          send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
        }
      } }), `git-worktree: ${label} route`)
    }

    /** Like {@link postRoute}, but the response is an NDJSON stream of live
     * progress events ended by a `done` frame (see ./stream.ts). A body-level
     * failure is still a plain 400 — the stream has not started yet. */
    const streamPostRoute = (path: string, label: string, handle: (deps: RouteDeps, body: unknown, live: RouteLive) => Promise<RouteOutcome>): void => {
      webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path, handler: async (req: IncomingMessage, res: ServerResponse) => {
        let body: unknown
        try {
          body = await readJson(req)
        } catch (error) {
          send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
          return
        }
        await streamRoute(res, live => handle(deps(), body, live))
      } }), `git-worktree: ${label} route`)
    }

    // Query-driven reads. Every mutation is a POST body.
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_STATUS, handler: async (req: IncomingMessage, res: ServerResponse) => {
      /* v8 ignore next -- node:http always sets url on server requests. */
      const query = new URL(req.url ?? '/', 'http://x').searchParams
      send(res, await handleStatus(deps(), query.get('path') ?? undefined))
    } }), 'git-worktree: status route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_HEAD, handler: async (req: IncomingMessage, res: ServerResponse) => {
      /* v8 ignore next -- node:http always sets url on server requests. */
      const query = new URL(req.url ?? '/', 'http://x').searchParams
      send(res, await handleHead(query.get('path') ?? undefined))
    } }), 'git-worktree: head route')

    postRoute(ROUTE_WORKTREE, 'worktree', handleCreateWorktree)
    postRoute(ROUTE_HISTORY, 'history', handleHistory)
    postRoute(ROUTE_AUTHORS, 'authors', handleAuthors)
    postRoute(ROUTE_COMMIT, 'commit', handleCommit)
    postRoute(ROUTE_SWITCH, 'switch', handleSwitch)
    postRoute(ROUTE_BRANCH, 'branch', handleCreateBranch)
    postRoute(ROUTE_BRANCH_RENAME, 'branch-rename', handleRenameBranch)
    postRoute(ROUTE_BRANCH_DELETE, 'branch-delete', handleDeleteBranch)
    streamPostRoute(ROUTE_FETCH, 'fetch', handleFetch)
    postRoute(ROUTE_GROUP, 'group', handleGroupWorktrees)
    streamPostRoute(ROUTE_UPDATE, 'update', handleUpdate)
    postRoute(ROUTE_PUSH_PLAN, 'push-plan', handlePushPlan)
    postRoute(ROUTE_PUSH_PREVIEW, 'push-preview', handlePushPreview)
    streamPostRoute(ROUTE_PUSH, 'push', handlePush)
    postRoute(ROUTE_INSPECT, 'inspect', handleInspectWorktree)
    postRoute(ROUTE_REMOVE, 'remove', handleRemoveWorktree)
    postRoute(ROUTE_EXISTS, 'exists', handlePathExists)
    postRoute(ROUTE_ENSURE_DIRECTORY, 'ensure-directory', handleEnsureDirectory)
    postRoute(ROUTE_WORKTREES_ALL, 'worktrees-all', handleWorktreesAll)
    postRoute(ROUTE_PURGE, 'purge', handlePurgeDirectory)
    postRoute(ROUTE_SESSION_CWD, 'session-cwd', handleSetSessionDirectory)

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_DEFERRED, handler: async (req: IncomingMessage, res: ServerResponse) => {
      /* v8 ignore next -- node:http always sets url on server requests. */
      const query = new URL(req.url ?? '/', 'http://x').searchParams
      send(res, await handleGetDeferredWorktree(deps(), query.get('sessionId') ?? undefined))
    } }), 'git-worktree: deferred-get route')

    const activeDeferredStreams = new Set<() => void>()
    webCtx.effect(() => () => {
      for (const close of [...activeDeferredStreams]) close()
      activeDeferredStreams.clear()
    }, 'git-worktree: deferred-events stream teardown')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_DEFERRED_EVENTS, handler: (req: IncomingMessage, res: ServerResponse) => {
      /* v8 ignore next -- node:http always sets url on server requests. */
      const query = new URL(req.url ?? '/', 'http://x').searchParams
      const sessionId = query.get('sessionId')?.trim() ?? ''
      if (sessionId === '') {
        send(res, { status: 400, body: { error: 'query parameter "sessionId" must be non-empty' } })
        return
      }
      const coordinator = deferredWorktrees
      if (coordinator === undefined) {
        send(res, { status: 501, body: { error: 'Deferred worktree creation is not supported by this host' } })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      const writeFrame = (payload: unknown): void => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`)
      }
      writeFrame({ state: coordinator.get(sessionId) })
      const unsubscribe = coordinator.subscribe(sessionId, writeFrame)
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n')
      }, 25_000)
      heartbeat.unref?.()
      let closed = false
      const cleanup = (): void => {
        if (closed) return
        closed = true
        activeDeferredStreams.delete(cleanup)
        clearInterval(heartbeat)
        unsubscribe()
        if (!res.writableEnded) res.end()
      }
      activeDeferredStreams.add(cleanup)
      req.on('close', cleanup)
      res.on('close', cleanup)
    } }), 'git-worktree: deferred-events route')

    postRoute(ROUTE_DEFERRED_ARM, 'deferred-arm', handleArmDeferredWorktree)
    postRoute(ROUTE_DEFERRED_ACTION, 'deferred-action', handleDeferredWorktreeAction)
    postRoute(ROUTE_PR_CONTEXT, 'pr-context', handlePrContext)
    postRoute(ROUTE_PR_RESOLVE, 'pr-resolve', handlePrResolve)
    streamPostRoute(ROUTE_PR_CHECKOUT, 'pr-checkout', handlePrCheckout)
  })
}
