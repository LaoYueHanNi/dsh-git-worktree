/**
 * dsh-git-worktree host half. Owns the settings document (~/.dsh/git-worktree/
 * settings.json) and — while a webServer service exists — the four HTTP
 * routes the browser half fetches. Headless profiles lose only the routes:
 * nothing else in the plugin has a browser dependency.
 */

import { homedir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context declaration merge into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { childProcessExec } from './git.js'
import {
  handleCreateWorktree, handleGetSettings, handlePutSettings, handleStatus, handleSwitch,
  type RouteDeps, type RouteOutcome,
} from './routes.js'
import { loadSettings, settingsFileOf, type StoredSettings } from './settings.js'
import { ROUTE_SETTINGS, ROUTE_STATUS, ROUTE_SWITCH, ROUTE_WORKTREE } from './wire.js'

export const name = 'dsh-git-worktree'

export const inject = []

/** Largest accepted request body (bytes) — these payloads are a few strings. */
const BODY_LIMIT = 64 * 1024

/**
 * Plugin apply: load the settings document, then mount routes on any
 * webServer that comes and goes.
 * @param ctx - host cordis context.
 */
export function apply(ctx: Context): void {
  const settingsFile = settingsFileOf(homedir())
  let cached: StoredSettings = { rootDir: '' }
  void loadSettings(settingsFile).then(value => { cached = value })

  const deps = (): RouteDeps => ({
    exec: childProcessExec,
    settingsFile,
    cachedSettings: () => cached,
    storeSettings: async (value) => { cached = value },
    home: () => homedir(),
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

    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE_SETTINGS, handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const outcome = req.method === 'PUT'
          ? await handlePutSettings(deps(), await readJson(req))
          : await handleGetSettings(deps())
        send(res, outcome)
      } catch (error) {
        send(res, { status: 400, body: { error: error instanceof Error ? error.message : String(error) } })
      }
    } }), 'git-worktree: settings route')

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
  })
}
