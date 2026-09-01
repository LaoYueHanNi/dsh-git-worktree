/**
 * dsh-git-worktree host half. Owns the worktree storage-root settings section
 * (the `git-worktree` namespace in the dsh settings document, registered
 * through SettingsProvider.installSection with the composition entry as its
 * base
 * layer) and — while a webServer service exists — the HTTP routes the browser
 * half fetches. A stored root edit takes effect live: the routes read the
 * section source per request, so no restart and no route re-registration.
 *
 * The legacy ~/.dsh/git-worktree/settings.json value migrates into the
 * namespace once, when a settings service first attaches and the user layer
 * has recorded no choice of its own; the renamed file stays behind as a
 * backup. Headless profiles lose only the routes: nothing else in the plugin
 * has a browser dependency.
 */

import { homedir } from 'node:os'
import { rename } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the webServer Context declaration merge into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the settings Context declaration merge (`ctx.settings`) —
// host 0.1.2 moved section installation onto the provider itself
// (`SettingsProvider.installSection`); the free `installSettingsSection` /
// `settingsNamespace` helpers of 0.1.1 are gone.
import type {} from '@deepseek-ai/dsh-settings'
import { childProcessExec } from './git.js'
import {
  handleCreateBranch, handleCreateWorktree, handleEnsureDirectory, handleFetch, handleGroupWorktrees, handleInspectWorktree, handlePathExists, handleRemoveWorktree, handleStatus, handleSwitch, handleUpdate,
  type RouteDeps, type RouteOutcome,
} from './routes.js'
import {
  loadLegacySettings, migratedFileOf, planLegacyMigration, settingsFileOf, validateRootDir,
} from './settings.js'
import { ROUTE_BRANCH, ROUTE_ENSURE_DIRECTORY, ROUTE_EXISTS, ROUTE_FETCH, ROUTE_GROUP, ROUTE_INSPECT, ROUTE_REMOVE, ROUTE_STATUS, ROUTE_SWITCH, ROUTE_UPDATE, ROUTE_WORKTREE } from './wire.js'

export const name = 'dsh-git-worktree'

export const inject = []

/** Largest accepted request body (bytes) — these payloads are a few strings. */
const BODY_LIMIT = 64 * 1024

export interface Config {
  /** Worktree storage root; defaults to `$DSH_HOME/gitworktree` (`~/.dsh/gitworktree`). */
  rootDir?: string
  /** Sidebar git grouping on/off; absent = on (the composition-entry layer's default). */
  groupSidebar?: boolean
}

/** Reject stale or misspelled config keys before defaults can hide them. */
export function validateConfig(config: Config): void {
  const unknown = Object.keys(config).find(key => key !== 'rootDir' && key !== 'groupSidebar')
  if (unknown !== undefined) {
    throw new Error(`GitWorktreeConfig: unknown key "${unknown}"`)
  }
  if (config.rootDir !== undefined && (typeof config.rootDir !== 'string' || config.rootDir.length === 0)) {
    throw new Error('GitWorktreeConfig: "rootDir" must be a non-empty string')
  }
  if (config.groupSidebar !== undefined && typeof config.groupSidebar !== 'boolean') {
    throw new Error('GitWorktreeConfig: "groupSidebar" must be a boolean')
  }
  validateRootDir(config.rootDir)
}

/** The settings namespace this plugin serves; its browser card spells the same string. */
export const GIT_WORKTREE_NS = 'git-worktree'

/** The settings-facing subset of the config: the worktree storage root and the sidebar grouping switch. */
export interface SectionConfig {
  /** Worktree storage root; absent/blank selects `$DSH_HOME/gitworktree`. */
  rootDir?: string
  /** Whether the sidebar groups same-repository workspaces; absent = on. */
  groupSidebar?: boolean
}

/** Schema resolving the `git-worktree` settings section. */
export const sectionSchema: z<SectionConfig> = z.object({
  rootDir: z.string(),
  groupSidebar: z.boolean(),
})

/** The section-shaped view of a config: absent keys stay absent (`exactOptionalPropertyTypes`). */
export function sectionOf(config: Config): SectionConfig {
  return {
    ...(config.rootDir === undefined ? {} : { rootDir: config.rootDir }),
    // The composition layer spells the shipped default (grouping ON) so a
    // user-layer unset can always fall back to it.
    groupSidebar: config.groupSidebar ?? true,
  }
}

/**
 * Plugin apply: install the settings section, migrate any legacy stored root
 * into it, then mount routes on any webServer that comes and goes.
 * @param ctx - host cordis context.
 * @param config - the composition entry config (the section's base layer).
 */
export function apply(ctx: Context, config: Config = {}): void {
  validateConfig(config)
  // The section source: the composition entry until a settings service
  // attaches, then `setSource` repoints it at the resolved settings scope.
  // A thunk, not a snapshot — reads see the current resolution at call time,
  // so the routes follow a stored edit without re-registering anything.
  let sectionSource: () => SectionConfig = () => sectionOf(config)

  const deps = (): RouteDeps => ({
    exec: childProcessExec,
    sectionRootDir: () => sectionSource().rootDir,
    home: () => homedir(),
    envHome: () => process.env.DSH_HOME,
  })

  // Host 0.1.2 hosts section installation on the provider itself: the same
  // composition-entry base, validate, setSource, and onChange hooks ride
  // `SettingsProvider.installSection`, reached through a settings injection.
  // The registration is an effect on this plugin's fiber either way, so a
  // late-attaching settings service is handled by the injection itself.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, GIT_WORKTREE_NS, sectionSchema, sectionOf(config), {
      validate: value => {
        validateRootDir(value.rootDir)
        if (value.groupSidebar !== undefined && typeof value.groupSidebar !== 'boolean') {
          throw new Error('groupSidebar must be a boolean')
        }
      },
      setSource: (source) => { sectionSource = source },
      onChange: () => {
        // The storage root takes effect live: the routes read the section
        // source per request, so a committed edit needs no action here.
      },
    })
  })

  // One-shot legacy migration: the pre-0.3 plugin persisted its own
  // ~/.dsh/git-work-tree/settings.json. Registered after installSettingsSection
  // so the namespace is on the ledger by the time this fiber runs; a failure
  // (or a user layer that already chose) leaves both documents exactly as
  // they are, and the next startup retries.
  ctx.inject(['settings'], (sctx) => {
    const file = settingsFileOf(homedir())
    void (async () => {
      const legacy = await loadLegacySettings(file)
      const descriptor = sctx.settings.describe().find(d => d.ns === GIT_WORKTREE_NS)
      if (descriptor === undefined) return
      const user = descriptor.user
      const userLayer = typeof user === 'object' && user !== null ? user as Record<string, unknown> : undefined
      const planned = planLegacyMigration(legacy, userLayer)
      if (planned === undefined) return
      try {
        await sctx.settings.update(GIT_WORKTREE_NS, { rootDir: planned })
        await rename(file, migratedFileOf(file))
        console.log(`[git-worktree] legacy settings migrated to the settings document (${planned})`)
      } catch (error) {
        console.warn('[git-worktree] legacy settings migration failed:', error instanceof Error ? error.message : String(error))
      }
    })()
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

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_STATUS, handler: async (req: IncomingMessage, res: ServerResponse) => {
      /* v8 ignore next -- node:http always sets url on server requests. */
      const query = new URL(req.url ?? '/', 'http://x').searchParams
      send(res, await handleStatus(deps(), query.get('path') ?? undefined))
    } }), 'git-worktree: status route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_WORKTREE, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleCreateWorktree(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: worktree route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_SWITCH, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleSwitch(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: switch route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_BRANCH, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleCreateBranch(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: branch route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_FETCH, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleFetch(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: fetch route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_GROUP, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleGroupWorktrees(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: group route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_UPDATE, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleUpdate(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: update route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_INSPECT, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleInspectWorktree(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: inspect route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_REMOVE, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleRemoveWorktree(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: remove route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_EXISTS, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handlePathExists(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: exists route')

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_ENSURE_DIRECTORY, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        send(res, await handleEnsureDirectory(deps(), await readJson(req)))
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: ensure-directory route')
  })
}
