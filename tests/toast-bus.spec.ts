import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitToast, hasGlobalToastHost, peekToast, resetToastsForTest, shiftToast, subscribeToasts } from '../src/client/toast-bus.ts'

describe('toast-bus', () => {
  afterEach(() => {
    resetToastsForTest()
  })

  it('queues toasts sequentially without overwriting earlier entries', () => {
    const listener = vi.fn()
    const off = subscribeToasts(listener)

    emitToast('first warning')
    emitToast('second info', 'success')
    expect(listener).toHaveBeenCalledTimes(2)

    const first = peekToast()
    expect(first).toMatchObject({ text: 'first warning' })
    expect(first?.tone).toBeUndefined()

    // Mismatched seq does not shift the head.
    shiftToast(9999)
    expect(peekToast()?.seq).toBe(first?.seq)

    shiftToast(first!.seq)
    const second = peekToast()
    expect(second).toMatchObject({ text: 'second info', tone: 'success' })

    shiftToast(second!.seq)
    expect(peekToast()).toBeUndefined()
    off()
  })

  it('reports no mounted global host by default', () => {
    expect(hasGlobalToastHost()).toBe(false)
  })
})
