import { describe, expect, it } from 'vitest'
import { mapLimit } from '../src/client/concurrency.ts'

/** A promise whose settlement the test controls (in-flight RPC stand-in). */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('mapLimit', () => {
  it('keeps results index-aligned with the input, not with completion order', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()]
    const run = mapLimit([0, 1, 2], 3, async (index) => gates[index]!.promise)
    // Settle backwards: the slowest input must still land at its own index.
    gates[2]!.resolve('third')
    gates[0]!.resolve('first')
    gates[1]!.resolve('second')
    expect(await run).toEqual(['first', 'second', 'third'])
  })

  it('never exceeds the limit and still drains every item', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 25 }, (_, index) => index)
    const out = await mapLimit(items, 4, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      await Promise.resolve()
      inFlight -= 1
      return item * 2
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(out).toEqual(items.map(item => item * 2))
  })

  it('starts the next item as soon as ONE worker frees up (no batch barrier)', async () => {
    const slow = deferred<string>()
    const started: number[] = []
    const run = mapLimit([0, 1, 2], 2, async (index) => {
      started.push(index)
      // Item 0 hangs; item 1 lands immediately and must release item 2
      // without waiting for the slow one (a fixed-batch split would not).
      if (index === 0) return slow.promise
      return `done-${String(index)}`
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toContain(2)
    slow.resolve('done-0')
    expect(await run).toEqual(['done-0', 'done-1', 'done-2'])
  })

  it('clamps a limit under 1 to sequential instead of stalling', async () => {
    const out = await mapLimit([1, 2, 3], 0, async (item) => item + 10)
    expect(out).toEqual([11, 12, 13])
  })

  it('answers an empty input without calling the worker', async () => {
    let calls = 0
    const out = await mapLimit([], 8, async (item: number) => { calls += 1; return item })
    expect(out).toEqual([])
    expect(calls).toBe(0)
  })

  it('propagates a rejection like Promise.all', async () => {
    await expect(mapLimit([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('item 2 blew up')
      return item
    })).rejects.toThrow('item 2 blew up')
  })
})
