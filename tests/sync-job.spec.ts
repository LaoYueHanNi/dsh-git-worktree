import { describe, expect, it, vi } from 'vitest'
import type { LiveCall } from '../src/client/api.ts'
import { cancelSyncJob, findSyncJob, recordPushFailure, runSyncJob, subscribeSyncJobs, takePushFailure } from '../src/client/sync-job.ts'

/** A request the test finishes by hand, exposing the live channel it got. */
function manual<T>() {
  let finish: (value: T) => void = () => undefined
  let fail: (error: unknown) => void = () => undefined
  let live: LiveCall = {}
  const request = (given: LiveCall): Promise<T> => {
    live = given
    return new Promise<T>((resolve, reject) => { finish = resolve; fail = reject })
  }
  return { request, finish: (value: T) => { finish(value) }, fail: (error: unknown) => { fail(error) }, live: () => live }
}

describe('sync job store', () => {
  it('publishes the job while it runs and removes it, handing back the result, when it ends', async () => {
    const call = manual<{ ok: true }>()
    const seen: (string | undefined)[] = []
    const stop = subscribeSyncJobs(() => { seen.push(findSyncJob('C:/repo')?.kind) })
    const pending = runSyncJob('C:/repo', 'update', call.request)
    expect(findSyncJob('C:/repo')).toMatchObject({ kind: 'update', cwd: 'C:/repo', stage: 'fetch' })
    expect(findSyncJob('C:/other')).toBeUndefined()
    call.finish({ ok: true })
    expect(await pending).toEqual({ result: { ok: true }, cancelled: false })
    expect(findSyncJob('C:/repo')).toBeUndefined()
    expect(seen).toEqual(['update', undefined])
    stop()
  })

  it('follows git’s progress lines, keeps the remote once named and drops the line at the merge step', async () => {
    const call = manual<{ ok: true }>()
    const pending = runSyncJob('C:/repo', 'update', call.request)
    call.live().onEvent?.({ type: 'progress', text: 'Fetching origin', remote: 'origin' })
    expect(findSyncJob('C:/repo')).toMatchObject({ text: 'Fetching origin', remote: 'origin' })
    expect(findSyncJob('C:/repo')?.percent).toBeUndefined()
    call.live().onEvent?.({ type: 'progress', text: 'Receiving objects:  40% (2/5)', percent: 40 })
    expect(findSyncJob('C:/repo')).toMatchObject({ text: 'Receiving objects:  40% (2/5)', percent: 40, remote: 'origin' })
    // A line that cannot be sized clears the bar instead of freezing it at 40.
    call.live().onEvent?.({ type: 'progress', text: 'remote: Enumerating objects' })
    expect(findSyncJob('C:/repo')?.percent).toBeUndefined()
    call.live().onEvent?.({ type: 'merge' })
    const merging = findSyncJob('C:/repo')
    expect(merging).toMatchObject({ stage: 'merge' })
    expect(merging?.text).toBeUndefined()
    expect(merging?.percent).toBeUndefined()
    call.finish({ ok: true })
    await pending
  })

  it('runs one job per directory: a second start for the same one does nothing', async () => {
    const first = manual<{ ok: true }>()
    const second = vi.fn(first.request)
    const other = manual<{ ok: true }>()
    const pending = runSyncJob('C:/repo', 'fetch', first.request)
    expect(await runSyncJob('C:/repo', 'update', second)).toBeUndefined()
    expect(second).not.toHaveBeenCalled()
    // Another directory is its own repository: it may sync at the same time.
    const otherPending = runSyncJob('C:/other', 'fetch', other.request)
    expect(findSyncJob('C:/other')).toBeDefined()
    first.finish({ ok: true })
    other.finish({ ok: true })
    await Promise.all([pending, otherPending])
    // Free again once it ended.
    const again = manual<{ ok: true }>()
    const third = runSyncJob('C:/repo', 'fetch', again.request)
    expect(findSyncJob('C:/repo')).toBeDefined()
    again.finish({ ok: true })
    await third
  })

  it('cancels through the abort signal and reports it; late progress does not repaint the card', async () => {
    const call = manual<{ ok: false; error: string }>()
    const pending = runSyncJob('C:/repo', 'fetch', call.request)
    const signal = call.live().signal
    expect(signal?.aborted).toBe(false)
    cancelSyncJob('C:/repo')
    expect(signal?.aborted).toBe(true)
    call.live().onEvent?.({ type: 'progress', text: 'Receiving objects:  99% (9/10)', percent: 99 })
    expect(findSyncJob('C:/repo')?.text).toBeUndefined()
    call.finish({ ok: false, error: 'aborted' })
    expect(await pending).toEqual({ result: { ok: false, error: 'aborted' }, cancelled: true })
    expect(findSyncJob('C:/repo')).toBeUndefined()
  })

  it('leaves the fast-forward step alone: cancel is ignored once the merge began', async () => {
    const call = manual<{ ok: true }>()
    const pending = runSyncJob('C:/repo', 'update', call.request)
    call.live().onEvent?.({ type: 'merge' })
    cancelSyncJob('C:/repo')
    expect(call.live().signal?.aborted).toBe(false)
    call.finish({ ok: true })
    expect(await pending).toEqual({ result: { ok: true }, cancelled: false })
  })

  it('ignores a cancel for a directory with no job', () => {
    expect(() => { cancelSyncJob('C:/nothing') }).not.toThrow()
  })

  it('clears the job and rethrows when the request itself throws', async () => {
    const call = manual<never>()
    const pending = runSyncJob('C:/repo', 'fetch', call.request)
    call.fail(new Error('boom'))
    await expect(pending).rejects.toThrow('boom')
    expect(findSyncJob('C:/repo')).toBeUndefined()
    // …and the directory is not stuck behind a job that no longer exists.
    const again = manual<{ ok: true }>()
    const next = runSyncJob('C:/repo', 'fetch', again.request)
    expect(findSyncJob('C:/repo')).toBeDefined()
    again.finish({ ok: true })
    await next
  })

  it('stops notifying a listener once it unsubscribed', async () => {
    const listener = vi.fn()
    const stop = subscribeSyncJobs(listener)
    stop()
    const call = manual<{ ok: true }>()
    const pending = runSyncJob('C:/repo', 'fetch', call.request)
    call.finish({ ok: true })
    await pending
    expect(listener).not.toHaveBeenCalled()
  })

  it('reads no job for an undefined directory', () => {
    expect(findSyncJob(undefined)).toBeUndefined()
  })

  describe('a push', () => {
    it('names its branch and remote from the first moment and keeps them through git’s lines', async () => {
      const call = manual<{ ok: true }>()
      const pending = runSyncJob('C:/repo', 'push', call.request, { branch: 'feature/x', remote: 'origin' })
      expect(findSyncJob('C:/repo')).toMatchObject({ kind: 'push', stage: 'fetch', branch: 'feature/x', remote: 'origin' })
      call.live().onEvent?.({ type: 'progress', text: 'Writing objects:  40% (2/5)', percent: 40 })
      expect(findSyncJob('C:/repo')).toMatchObject({ text: 'Writing objects:  40% (2/5)', percent: 40, branch: 'feature/x', remote: 'origin' })
      call.finish({ ok: true })
      await pending
    })

    it('leaves branch and remote out of a fetch or update, which are about the checked-out branch', async () => {
      const call = manual<{ ok: true }>()
      const pending = runSyncJob('C:/repo', 'update', call.request)
      const job = findSyncJob('C:/repo')
      expect(job).not.toHaveProperty('branch')
      expect(job).not.toHaveProperty('remote')
      call.finish({ ok: true })
      await pending
    })

    it('keeps a failed push for the directory until it is taken, once, and tells the listeners', () => {
      const listener = vi.fn()
      const stop = subscribeSyncJobs(listener)
      const failure = { branch: 'feature/x', remote: 'origin', target: 'feature/x', tags: 'none' as const, error: 'rejected' }
      expect(takePushFailure('C:/repo')).toBeUndefined()
      recordPushFailure('C:/repo', failure)
      expect(listener).toHaveBeenCalledTimes(1)
      // Another directory's window is not the place for it.
      expect(takePushFailure('C:/other')).toBeUndefined()
      expect(takePushFailure('C:/repo')).toEqual(failure)
      expect(takePushFailure('C:/repo')).toBeUndefined()
      expect(takePushFailure(undefined)).toBeUndefined()
      stop()
    })

    it('keeps only the newest failure of a directory', () => {
      recordPushFailure('C:/repo', { branch: 'a', remote: 'origin', target: 'a', tags: 'none', error: 'first' })
      recordPushFailure('C:/repo', { branch: 'b', remote: 'origin', target: 'b', tags: 'all', error: 'second' })
      expect(takePushFailure('C:/repo')).toMatchObject({ branch: 'b', error: 'second' })
      expect(takePushFailure('C:/repo')).toBeUndefined()
    })
  })
})
