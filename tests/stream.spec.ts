import { describe, expect, it } from 'vitest'
import type { RouteLive } from '../src/routes.ts'
import { streamRoute, type StreamTarget } from '../src/stream.ts'
import type { SyncFrame } from '../src/wire.ts'

/** A response double: records what is written and lets a test close the socket. */
function response() {
  const written: string[] = []
  const listeners: (() => void)[] = []
  let head: { status: number; headers: Record<string, string> } | undefined
  let ended = false
  const target: StreamTarget = {
    writeHead: (status, headers) => { head = { status, headers } },
    write: (chunk) => { written.push(chunk) },
    end: () => { ended = true },
    on: (_event, listener) => { listeners.push(listener) },
    get writableEnded() { return ended },
  }
  return {
    target,
    head: () => head,
    frames: (): SyncFrame[] => written.join('').split('\n').filter(line => line !== '').map(line => JSON.parse(line) as SyncFrame),
    raw: () => written.join(''),
    /** The socket closes (a client leaving mid-stream, or the normal end). */
    close: () => { for (const listener of listeners) listener() },
    ended: () => ended,
  }
}

describe('streamRoute', () => {
  it('answers 200 NDJSON at once, then events, then a done frame carrying the real status', async () => {
    const res = response()
    await streamRoute(res.target, async (live: RouteLive) => {
      expect(res.head()?.status).toBe(200)
      live.emit({ type: 'progress', text: 'Receiving objects:  50% (1/2)', percent: 50 })
      live.emit({ type: 'merge' })
      return { status: 200, body: { branch: 'main', updated: true } }
    })
    expect(res.head()?.headers['content-type']).toContain('application/x-ndjson')
    expect(res.head()?.headers['x-accel-buffering']).toBe('no')
    expect(res.frames()).toEqual([
      { type: 'progress', text: 'Receiving objects:  50% (1/2)', percent: 50 },
      { type: 'merge' },
      { type: 'done', status: 200, body: { branch: 'main', updated: true } },
    ])
    expect(res.raw().endsWith('\n')).toBe(true)
    expect(res.ended()).toBe(true)
  })

  it('carries a failure in the done frame, because the status line is already sent', async () => {
    const res = response()
    await streamRoute(res.target, async () => ({ status: 400, body: { error: 'git fetch failed' } }))
    expect(res.frames()).toEqual([{ type: 'done', status: 400, body: { error: 'git fetch failed' } }])
  })

  it('turns a handler that throws into a 500 done frame instead of a hung stream', async () => {
    const res = response()
    await streamRoute(res.target, async () => { throw new Error('boom') })
    expect(res.frames()).toEqual([{ type: 'done', status: 500, body: { error: 'boom' } }])
    expect(res.ended()).toBe(true)
  })

  it('aborts the handler’s signal when the socket closes before the stream finished', async () => {
    const res = response()
    let seen: AbortSignal | undefined
    await streamRoute(res.target, async (live) => {
      seen = live.signal
      expect(live.signal.aborted).toBe(false)
      res.close()
      expect(live.signal.aborted).toBe(true)
      // Writing to a connection nobody holds would only raise EPIPE.
      live.emit({ type: 'progress', text: 'late' })
      return { status: 499, body: { error: 'Cancelled' } }
    })
    expect(seen?.aborted).toBe(true)
    expect(res.raw()).toBe('')
  })

  it('does not abort on the normal close that follows a finished response', async () => {
    const res = response()
    let seen: AbortSignal | undefined
    await streamRoute(res.target, async (live) => {
      seen = live.signal
      return { status: 200, body: { remote: 'all' } }
    })
    res.close()
    expect(seen?.aborted).toBe(false)
  })
})
