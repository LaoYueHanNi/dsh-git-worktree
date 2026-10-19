import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthors, fetchCommit, fetchHistory } from '../src/client/api.ts'
import { ROUTE_AUTHORS, ROUTE_COMMIT, ROUTE_HISTORY } from '../src/wire.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('history client requests', () => {
  it('forwards branch identity and pinned pagination, and cancels a superseded read', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const body = { repoPath: 'C:/repo with spaces', ref: 'refs/remotes/origin/feature/x', tip: 'a'.repeat(40), offset: '100' }
    const pending = fetchHistory(body, controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(ROUTE_HISTORY, expect.objectContaining({ method: 'POST', body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' }))
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: 'aborted' })
  })

  it('reads complete detail envelopes and surfaces JSON and non-JSON errors', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ body: 'first\n\nlast', files: 2 })))
    expect(await fetchCommit('/repo', 'a'.repeat(40), signal)).toEqual({ ok: true, body: 'first\n\nlast', files: 2 })
    expect(fetchMock).toHaveBeenLastCalledWith(ROUTE_COMMIT, expect.objectContaining({ body: JSON.stringify({ repoPath: '/repo', oid: 'a'.repeat(40) }), signal }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tip: 'a'.repeat(40), authors: ['Ada'] })))
    expect(await fetchAuthors({ repoPath: '/repo', ref: 'refs/heads/main', tip: 'a'.repeat(40) }, signal)).toEqual({ ok: true, tip: 'a'.repeat(40), authors: ['Ada'] })
    expect(fetchMock).toHaveBeenLastCalledWith(ROUTE_AUTHORS, expect.objectContaining({ method: 'POST', body: JSON.stringify({ repoPath: '/repo', ref: 'refs/heads/main', tip: 'a'.repeat(40) }), signal }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'missing ref' }), { status: 400 }))
    expect(await fetchHistory({ repoPath: '/repo', ref: 'HEAD' }, signal)).toEqual({ ok: false, error: 'missing ref' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await fetchCommit('/repo', 'a'.repeat(40), signal)).toEqual({ ok: false, error: 'HTTP 503' })
  })
})
