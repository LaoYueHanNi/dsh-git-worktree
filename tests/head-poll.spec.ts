import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHeadPoll, HEAD_POLL_MS, HEAD_POLL_TIMEOUT_MS, type HeadPollEnv } from '../src/client/head-poll.ts'

type Probe = HeadPollEnv['fetchHead']

function harness(fetchHead: Probe, visibility: () => 'visible' | 'hidden'): {
  poll: ReturnType<typeof createHeadPoll>
  emitVisibility: () => void
} {
  const listeners = new Set<() => void>()
  const poll = createHeadPoll({
    fetchHead,
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (id) => { clearInterval(id as ReturnType<typeof setInterval>) },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (id) => { clearTimeout(id as ReturnType<typeof setTimeout>) },
    visibility,
    onVisibility: (callback) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
  })
  return { poll, emitVisibility: () => { for (const callback of listeners) callback() } }
}

describe('createHeadPoll', () => {
  afterEach(() => { vi.useRealTimers() })

  it('asks once per directory per tick and reports the name to every listener', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    let branch = 'main'
    const { poll } = harness(async (path) => {
      calls.push(path)
      return { ok: true, repo: true, currentBranch: branch }
    }, () => 'visible')
    const seenA: string[] = []
    const seenB: string[] = []
    const stopA = poll.subscribe('C:\\Repo', (name) => { seenA.push(name) })
    const stopB = poll.subscribe('c:/Repo/', (name) => { seenB.push(name) })
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(calls).toEqual(['C:\\Repo'])
    expect(seenA).toEqual(['main'])
    expect(seenB).toEqual(['main'])
    branch = 'feat/x'
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(seenA).toEqual(['main', 'feat/x'])
    expect(seenB).toEqual(['main', 'feat/x'])
    expect(calls).toHaveLength(2)
    stopA()
    stopB()
  })

  it('fetches each distinct directory', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const { poll } = harness(async (path) => {
      calls.push(path)
      return { ok: true, repo: true, currentBranch: 'main' }
    }, () => 'visible')
    const stopA = poll.subscribe('/a', () => {})
    const stopB = poll.subscribe('/b', () => {})
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(calls).toEqual(['/a', '/b'])
    stopA()
    stopB()
  })

  it('does not notify when the read is pending, not a repo, or a failure', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const answers: Array<Awaited<ReturnType<Probe>>> = [
      { ok: true, repo: true, pending: true },
      { ok: true, repo: false },
      { ok: false, error: 'HTTP 500' },
    ]
    const { poll } = harness(async () => {
      const next = answers.shift()
      if (next === undefined) throw new Error('boom')
      return next
    }, () => 'visible')
    const stop = poll.subscribe('/repo', (name) => { seen.push(name) })
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS * 4)
    expect(seen).toEqual([])
    stop()
  })

  it('pauses while hidden and resumes when the page is visible again', async () => {
    vi.useFakeTimers()
    let visible: 'visible' | 'hidden' = 'hidden'
    const calls: string[] = []
    const { poll, emitVisibility } = harness(async (path) => {
      calls.push(path)
      return { ok: true, repo: true, currentBranch: 'main' }
    }, () => visible)
    const stop = poll.subscribe('/repo', () => {})
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS * 3)
    expect(calls).toEqual([])
    visible = 'visible'
    emitVisibility()
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS - 1)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual(['/repo'])
    visible = 'hidden'
    emitVisibility()
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS * 3)
    expect(calls).toEqual(['/repo'])
    visible = 'visible'
    emitVisibility()
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(calls).toEqual(['/repo', '/repo'])
    stop()
  })

  it('stops after the last listener leaves, and skips a listener that left mid-read', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let waiting = true
    const { poll } = harness(async (path) => {
      calls.push(path)
      if (waiting) {
        waiting = false
        await gate
      }
      return { ok: true, repo: true, currentBranch: 'main' }
    }, () => 'visible')
    const seen: string[] = []
    const stop = poll.subscribe('/repo', (name) => { seen.push(name) })
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(calls).toEqual(['/repo'])
    stop()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([])
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS * 2)
    expect(calls).toEqual(['/repo'])
  })

  it('keeps going when one listener throws', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const { poll } = harness(async () => ({ ok: true, repo: true, currentBranch: 'main' }), () => 'visible')
    const stopA = poll.subscribe('/repo', () => { throw new Error('boom') })
    const stopB = poll.subscribe('/repo', (name) => { seen.push(name) })
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(seen).toEqual(['main'])
    stopA()
    stopB()
  })

  it('keeps other directories polling, times out a stuck read, and ignores its late result', async () => {
    vi.useFakeTimers()
    let release!: (result: Awaited<ReturnType<Probe>>) => void
    const stuck = new Promise<Awaited<ReturnType<Probe>>>((resolve) => { release = resolve })
    const signals: AbortSignal[] = []
    let branch = 'main'
    const probe = vi.fn<Probe>((path, signal) => {
      if (path === '/slow') {
        signals.push(signal)
        if (signals.length === 1) return stuck
      }
      return Promise.resolve({ ok: true, repo: true, currentBranch: branch })
    })
    const { poll } = harness(probe, () => 'visible')
    const slowSeen: string[] = []
    const fastSeen: string[] = []
    const stopSlow = poll.subscribe('/slow', (name) => { slowSeen.push(name) })
    const stopFast = poll.subscribe('/fast', (name) => { fastSeen.push(name) })
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    branch = 'feat/new'
    await vi.advanceTimersByTimeAsync(HEAD_POLL_TIMEOUT_MS - 1)
    expect(signals).toHaveLength(1) // No overlapping read for the slow directory.
    expect(signals[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals[0]?.aborted).toBe(true)
    expect(fastSeen).toEqual(['main', 'feat/new'])
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(signals).toHaveLength(2)
    expect(fastSeen).toEqual(['main', 'feat/new', 'feat/new'])
    expect(slowSeen).toEqual(['feat/new'])
    release({ ok: true, repo: true, currentBranch: 'stale' })
    await vi.advanceTimersByTimeAsync(0)
    expect(slowSeen).toEqual(['feat/new'])
    stopSlow()
    stopFast()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an unsubscribed read and lets a new subscription to that path proceed', async () => {
    vi.useFakeTimers()
    let release!: (result: Awaited<ReturnType<Probe>>) => void
    const pending = new Promise<Awaited<ReturnType<Probe>>>((resolve) => { release = resolve })
    const probe = vi.fn<Probe>()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue({ ok: true, repo: true, currentBranch: 'new' })
    const { poll } = harness(probe, () => 'visible')
    const oldListener = vi.fn()
    const stopOld = poll.subscribe('/repo', oldListener)
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    const oldSignal = probe.mock.calls[0]?.[1]
    stopOld()
    expect(oldSignal?.aborted).toBe(true)
    const newListener = vi.fn()
    const stopNew = poll.subscribe('/repo', newListener)
    stopOld() // An old cleanup must not remove the replacement bucket.
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(newListener).toHaveBeenCalledExactlyOnceWith('new')
    release({ ok: true, repo: true, currentBranch: 'old' })
    await vi.advanceTimersByTimeAsync(0)
    expect(oldListener).not.toHaveBeenCalled()
    expect(newListener).toHaveBeenCalledTimes(1)
    stopNew()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels in-flight reads while hidden and resumes without waiting for them', async () => {
    vi.useFakeTimers()
    let visible: 'visible' | 'hidden' = 'visible'
    let release!: (result: Awaited<ReturnType<Probe>>) => void
    const pending = new Promise<Awaited<ReturnType<Probe>>>((resolve) => { release = resolve })
    const probe = vi.fn<Probe>()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue({ ok: true, repo: true, currentBranch: 'new' })
    const { poll, emitVisibility } = harness(probe, () => visible)
    const listener = vi.fn()
    const stop = poll.subscribe('/repo', listener)
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    visible = 'hidden'
    emitVisibility()
    expect(probe.mock.calls[0]?.[1].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    visible = 'visible'
    emitVisibility()
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(listener).toHaveBeenCalledExactlyOnceWith('new')
    release({ ok: true, repo: true, currentBranch: 'old' })
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('retries a rejected read on the next tick without leaking its timeout', async () => {
    vi.useFakeTimers()
    const probe = vi.fn<Probe>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, repo: true, currentBranch: 'recovered' })
    const { poll } = harness(probe, () => 'visible')
    const listener = vi.fn()
    const stop = poll.subscribe('/repo', listener)
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(listener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    expect(listener).toHaveBeenCalledExactlyOnceWith('recovered')
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a pending request at the configured timeout', async () => {
    vi.useFakeTimers()
    const probe = vi.fn<Probe>(() => new Promise(() => {}))
    const { poll } = harness(probe, () => 'visible')
    const stop = poll.subscribe('/repo', vi.fn())
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS)
    const signal = probe.mock.calls[0]?.[1]
    await vi.advanceTimersByTimeAsync(HEAD_POLL_TIMEOUT_MS - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
