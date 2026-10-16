/**
 * Streamed route responses: the HTTP half of the live fetch/update progress.
 *
 * A streamed route answers `200` at once and then writes one JSON
 * {@link SyncFrame} per line while the handler works; the last line is `done`
 * and carries the status and body the same route would have answered in one
 * piece. The status line is therefore no longer the verdict — the `done`
 * frame is — which is what lets a failure that happens after minutes of
 * transfer still be reported.
 *
 * The caller cancels by closing the connection. A response that is not yet
 * finished when its socket closes aborts the handler's signal, which kills
 * git. (`res`'s `close`, not `req`'s: a request body that was fully read
 * closes early on modern Node whether or not the client is still there.)
 *
 * @module git-worktree/stream
 */

import type { RouteLive, RouteOutcome } from './routes.js'
import { NDJSON_TYPE, type SyncFrame } from './wire.js'

/** The slice of `http.ServerResponse` a stream needs — a fake in tests. */
export interface StreamTarget {
  writeHead: (status: number, headers: Record<string, string>) => unknown
  write: (chunk: string) => unknown
  end: () => unknown
  on: (event: 'close', listener: () => void) => unknown
  readonly writableEnded: boolean
}

/**
 * Run one handler as an NDJSON stream.
 * @param res - the response to stream into.
 * @param handle - the route logic; emits events through `live` and resolves
 * with the outcome that becomes the `done` frame.
 */
export async function streamRoute(res: StreamTarget, handle: (live: RouteLive) => Promise<RouteOutcome>): Promise<void> {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  res.writeHead(200, {
    'content-type': `${NDJSON_TYPE}; charset=utf-8`,
    'cache-control': 'no-store',
    // Tell a reverse proxy not to hold the lines back until the stream ends.
    'x-accel-buffering': 'no',
  })
  const write = (frame: SyncFrame): void => {
    // Nobody is listening after an abort; writing would only raise EPIPE.
    if (controller.signal.aborted || res.writableEnded) return
    res.write(`${JSON.stringify(frame)}\n`)
  }
  let outcome: RouteOutcome
  try {
    outcome = await handle({ signal: controller.signal, emit: write })
  } catch (error) {
    // Handlers answer their own failures; this is the backstop for a bug.
    outcome = { status: 500, body: { error: error instanceof Error ? error.message : String(error) } }
  }
  write({ type: 'done', status: outcome.status, body: outcome.body })
  if (!res.writableEnded) res.end()
}
