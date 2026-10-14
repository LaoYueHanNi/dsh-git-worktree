import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHead } from '../src/client/api.ts'
import { ROUTE_HEAD } from '../src/wire.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchHead cancellation', () => {
  it('passes the signal to fetch and turns an aborted read into a retryable failure', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = fetchHead('C:/repo with spaces', controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(`${ROUTE_HEAD}?path=C%3A%2Frepo%20with%20spaces`, {
      cache: 'no-store', signal: controller.signal,
    })
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: 'aborted' })
  })
})
