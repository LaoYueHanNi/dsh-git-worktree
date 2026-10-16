import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestFetch, requestPush, requestUpdate } from '../src/client/api.ts'
import { NDJSON_TYPE, ROUTE_FETCH, ROUTE_PUSH, ROUTE_UPDATE, type SyncEvent, type SyncFrame } from '../src/wire.ts'

afterEach(() => { vi.unstubAllGlobals() })

const encoder = new TextEncoder()

/** A streamed response whose chunks arrive exactly as given. */
function ndjson(chunks: (string | Uint8Array)[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': `${NDJSON_TYPE}; charset=utf-8` } })
}

const line = (frame: SyncFrame): string => `${JSON.stringify(frame)}\n`

describe('streamed requests', () => {
  it('delivers progress events in order, then resolves with the body of the done frame', async () => {
    const fetchMock = vi.fn(async () => ndjson([
      line({ type: 'progress', text: 'Receiving objects:  10% (1/10)', percent: 10 }),
      line({ type: 'merge' }),
      line({ type: 'done', status: 200, body: { branch: 'main', updated: true } }),
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const events: SyncEvent[] = []
    const result = await requestUpdate('C:/repo', { onEvent: event => events.push(event) })
    expect(result).toEqual({ ok: true, branch: 'main', updated: true })
    expect(events).toEqual([{ type: 'progress', text: 'Receiving objects:  10% (1/10)', percent: 10 }, { type: 'merge' }])
    expect(fetchMock).toHaveBeenCalledWith(ROUTE_UPDATE, expect.objectContaining({ method: 'POST', body: JSON.stringify({ repoPath: 'C:/repo' }) }))
  })

  it('streams a push the same way: the body goes out, progress comes in, the done frame is the result', async () => {
    const fetchMock = vi.fn(async () => ndjson([
      line({ type: 'progress', text: 'Writing objects:  50% (1/2), 512.00 KiB | 1.00 MiB/s', percent: 50 }),
      line({ type: 'done', status: 200, body: { branch: 'feature/x', remote: 'origin', target: 'feature/x' } }),
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const events: SyncEvent[] = []
    const body = { repoPath: 'C:/repo', branch: 'feature/x', remote: 'origin', target: 'feature/x', tags: 'none' as const }
    expect(await requestPush(body, { onEvent: event => events.push(event) })).toEqual({ ok: true, branch: 'feature/x', remote: 'origin', target: 'feature/x' })
    expect(events).toEqual([{ type: 'progress', text: 'Writing objects:  50% (1/2), 512.00 KiB | 1.00 MiB/s', percent: 50 }])
    expect(fetchMock).toHaveBeenCalledWith(ROUTE_PUSH, expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }))
  })

  it('hands a failed push’s git words to the caller from the done frame, and still reads a host that answers in one piece', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([line({ type: 'done', status: 400, body: { error: '! [rejected] (fetch first)' } })])))
    expect(await requestPush({ repoPath: 'C:/repo', branch: 'x' })).toEqual({ ok: false, error: '! [rejected] (fetch first)' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ branch: 'x', remote: 'origin', target: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await requestPush({ repoPath: 'C:/repo', branch: 'x' })).toEqual({ ok: true, branch: 'x', remote: 'origin', target: 'x' })
  })

  it('works without a listener (the call needs no progress UI to succeed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([line({ type: 'done', status: 200, body: { remote: 'all' } })])))
    expect(await requestFetch('C:/repo')).toEqual({ ok: true, remote: 'all' })
  })

  it('reassembles lines that arrive split across chunks, multi-byte characters included', async () => {
    const bytes = encoder.encode(line({ type: 'progress', text: 'Fetching 远程仓库', remote: '远程仓库' }))
    // Cut inside the three-byte encoding of a Chinese character.
    const cut = bytes.indexOf(0xe8) + 1
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([
      bytes.slice(0, cut), bytes.slice(cut, cut + 7), bytes.slice(cut + 7),
      line({ type: 'done', status: 200, body: { remote: 'all' } }),
    ])))
    const events: SyncEvent[] = []
    await requestFetch('C:/repo', { onEvent: event => events.push(event) })
    expect(events).toEqual([{ type: 'progress', text: 'Fetching 远程仓库', remote: '远程仓库' }])
  })

  it('reports the error of a done frame whose status is not 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([
      line({ type: 'progress', text: 'Receiving objects:  90% (9/10)', percent: 90 }),
      line({ type: 'done', status: 500, body: { error: 'git fetch --all --prune failed (exit 128): fatal: early EOF' } }),
    ])))
    expect(await requestFetch('C:/repo')).toEqual({ ok: false, error: 'git fetch --all --prune failed (exit 128): fatal: early EOF' })
  })

  it('names the status when the failing done frame carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([line({ type: 'done', status: 502, body: null })])))
    expect(await requestFetch('C:/repo')).toEqual({ ok: false, error: 'HTTP 502' })
  })

  it('fails honestly when the stream ends without a done frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([line({ type: 'progress', text: 'Receiving objects:  50% (5/10)', percent: 50 })])))
    const result = await requestFetch('C:/repo')
    expect(result).toEqual({ ok: false, error: 'Connection closed before the operation finished' })
  })

  it('skips a garbled line instead of losing the call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([
      '{"type":"progress","te\n',
      line({ type: 'done', status: 200, body: { remote: 'all' } }),
    ])))
    expect(await requestFetch('C:/repo')).toEqual({ ok: true, remote: 'all' })
  })

  it('reads a closing done frame that has no trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([JSON.stringify({ type: 'done', status: 200, body: { remote: 'all' } })])))
    expect(await requestFetch('C:/repo')).toEqual({ ok: true, remote: 'all' })
  })

  it('reads a non-stream answer as the ordinary envelope (body-level 400, or a host that predates streaming)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid JSON body' }), { status: 400, headers: { 'content-type': 'application/json' } })))
    expect(await requestFetch('C:/repo')).toEqual({ ok: false, error: 'invalid JSON body' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ remote: 'all' }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await requestFetch('C:/repo')).toEqual({ ok: true, remote: 'all' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await requestFetch('C:/repo')).toEqual({ ok: false, error: 'HTTP 404' })
  })

  it('passes the signal on and turns an abort into a failed call', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { reject(new Error('The operation was aborted')) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = requestFetch('C:/repo', { signal: controller.signal })
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: 'The operation was aborted' })
  })

  it('turns an abort in the middle of the stream into a failed call', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(source) {
          source.enqueue(encoder.encode(line({ type: 'progress', text: 'Receiving objects:  5% (1/20)', percent: 5 })))
          options?.signal?.addEventListener('abort', () => { source.error(new Error('The operation was aborted')) }, { once: true })
        },
      })
      return new Response(stream, { headers: { 'content-type': NDJSON_TYPE } })
    }))
    const events: SyncEvent[] = []
    const pending = requestFetch('C:/repo', { signal: controller.signal, onEvent: (event) => { events.push(event); controller.abort() } })
    expect(await pending).toEqual({ ok: false, error: 'The operation was aborted' })
    expect(events).toHaveLength(1)
  })
})
