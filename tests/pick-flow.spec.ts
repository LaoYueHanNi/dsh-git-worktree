import { describe, expect, it, vi } from 'vitest'
import { PickFlowController, type PickFlowHooks } from '../src/client/pick-flow.ts'

/** A promise whose settlement the test controls (in-flight RPC stand-in). */
interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Hooks recorder: vi.fn stand-ins plus the calls in flight. */
function harness(overrides: Partial<PickFlowHooks> = {}): PickFlowHooks & {
  pick: Deferred<string | null>
  create: Deferred<{ workspaceId: string }>
} {
  const pick = deferred<string | null>()
  const create = deferred<{ workspaceId: string }>()
  return {
    pickDirectory: overrides.pickDirectory ?? (() => pick.promise),
    createWorkspace: overrides.createWorkspace ?? (() => create.promise),
    onPicked: overrides.onPicked ?? vi.fn(),
    onCancelled: overrides.onCancelled ?? vi.fn(),
    onFailed: overrides.onFailed ?? vi.fn(),
    pick,
    create,
  }
}

describe('PickFlowController rising-edge start', () => {
  it('starts exactly ONE pick per open, no matter how many times true re-syncs', async () => {
    const hooks = harness()
    const pickCall = vi.fn(() => hooks.pick.promise)
    hooks.pickDirectory = pickCall
    const controller = new PickFlowController()
    controller.attach(hooks)
    // open=true, then the parent re-renders (fresh callbacks!) and re-syncs.
    controller.sync(true)
    controller.attach(harness())
    controller.sync(true)
    controller.sync(true)
    expect(pickCall).toHaveBeenCalledTimes(1)
    hooks.pick.resolve('E:\\repo')
    await Promise.resolve()
    // createWorkspace went through the LATEST attach.
    hooks.create.resolve({ workspaceId: 'w1' })
    await Promise.resolve()
    expect(hooks.onPicked).toHaveBeenCalledWith('w1')
  })

  it('does not start while closed, and a falling edge alone starts nothing', () => {
    const hooks = harness()
    const pickCall = vi.fn(() => hooks.pick.promise)
    hooks.pickDirectory = pickCall
    const controller = new PickFlowController()
    controller.attach(hooks)
    controller.sync(false)
    controller.sync(false)
    expect(pickCall).not.toHaveBeenCalled()
  })
})

describe('PickFlowController outcomes', () => {
  it('runs pick → create → onPicked with the chosen path', async () => {
    const hooks = harness()
    const create = vi.fn(() => hooks.create.promise)
    hooks.createWorkspace = create
    const controller = new PickFlowController()
    controller.attach(hooks)
    controller.sync(true)
    hooks.pick.resolve('E:\\repo')
    await Promise.resolve()
    expect(create).toHaveBeenCalledWith({ path: 'E:\\repo' })
    hooks.create.resolve({ workspaceId: 'w9' })
    await Promise.resolve()
    expect(hooks.onPicked).toHaveBeenCalledWith('w9')
    expect(hooks.onCancelled).not.toHaveBeenCalled()
    expect(hooks.onFailed).not.toHaveBeenCalled()
  })

  it('treats null and empty picks as cancellation (no create, no error)', async () => {
    for (const cancelled of [null, ''] as const) {
      const hooks = harness()
      const create = vi.fn(() => hooks.create.promise)
      hooks.createWorkspace = create
      const controller = new PickFlowController()
      controller.attach(hooks)
      controller.sync(true)
      hooks.pick.resolve(cancelled)
      await Promise.resolve()
      expect(hooks.onCancelled).toHaveBeenCalledTimes(1)
      expect(create).not.toHaveBeenCalled()
      expect(hooks.onFailed).not.toHaveBeenCalled()
    }
  })

  it('reports a rejected pick or create through onFailed and stays retryable', async () => {
    const hooks = harness()
    hooks.pickDirectory = () => Promise.reject(new Error('picker blew up'))
    const controller = new PickFlowController()
    controller.attach(hooks)
    controller.sync(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.onFailed).toHaveBeenCalledWith('picker blew up')
    expect(hooks.onPicked).not.toHaveBeenCalled()

    // Retry: close (error path already closed the dialog), then a fresh edge.
    hooks.onFailed = vi.fn()
    const second = harness()
    controller.attach(second)
    controller.sync(false)
    controller.sync(true)
    second.pick.resolve('E:\\two')
    await Promise.resolve()
    second.create.resolve({ workspaceId: 'w2' })
    await Promise.resolve()
    expect(second.onPicked).toHaveBeenCalledWith('w2')
  })
})

describe('PickFlowController invalidation', () => {
  it('discards a pick that settles after the dialog closed (falling edge)', async () => {
    const hooks = harness()
    const controller = new PickFlowController()
    controller.attach(hooks)
    controller.sync(true)
    controller.sync(false) // user closed / flow torn down while the chooser was up
    hooks.pick.resolve('E:\\repo')
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.onPicked).not.toHaveBeenCalled()
    expect(hooks.onCancelled).not.toHaveBeenCalled()
    expect(hooks.onFailed).not.toHaveBeenCalled()
  })

  it('discards a create that settles after the dialog closed', async () => {
    const hooks = harness()
    const controller = new PickFlowController()
    controller.attach(hooks)
    controller.sync(true)
    hooks.pick.resolve('E:\\repo')
    await Promise.resolve()
    controller.sync(false)
    hooks.create.resolve({ workspaceId: 'w1' })
    await Promise.resolve()
    expect(hooks.onPicked).not.toHaveBeenCalled()
  })

  it('fires nothing after kill() (unmount)', async () => {
    const hooks = harness()
    const controller = new PickFlowController()
    controller.attach(hooks)
    controller.sync(true)
    controller.kill()
    hooks.pick.resolve('E:\\repo')
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.onPicked).not.toHaveBeenCalled()
    expect(hooks.onCancelled).not.toHaveBeenCalled()
    expect(hooks.onFailed).not.toHaveBeenCalled()
  })
})
