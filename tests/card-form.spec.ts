import { describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, type SectionValue } from '../src/client/card-form.ts'

/**
 * Scripted settings scope: snapshots the form reads, plus the writes it
 * should land. `applyWrites` (default true) makes a write update the user
 * layer exactly as the Host would; turning it off scripts a refusal (the
 * write crossed the wire but nothing stored).
 */
class FakeScope implements SettingsScope<SectionValue> {
  private snapshot: SettingsScopeSnapshot<SectionValue>
  private readonly listeners = new Set<() => void>()
  readonly writes: Array<{ op: 'set' | 'unset'; field: string; value: unknown }> = []
  applyWrites = true

  constructor(section: SectionValue = {}, over: Partial<SettingsScopeSnapshot<SectionValue>> = {}) {
    this.snapshot = {
      status: 'ready',
      value: section,
      base: {},
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
      ...over,
    }
  }

  getSnapshot(): SettingsScopeSnapshot<SectionValue> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    this.writes.push({ op: 'set', field, value })
    if (this.applyWrites) this.replaceUser({ ...this.userRecord(), [field]: value }, field, value)
  }

  async unset(field: string): Promise<void> {
    this.writes.push({ op: 'unset', field, value: undefined })
    if (this.applyWrites) {
      const next = this.userRecord()
      delete next[field]
      this.replaceUser(next, field, undefined, true)
    }
  }

  private userRecord(): Record<string, unknown> {
    const user = this.snapshot.user
    return typeof user === 'object' && user !== null ? { ...(user as Record<string, unknown>) } : {}
  }

  private replaceUser(user: Record<string, unknown>, field: string, value: unknown, removed = false): void {
    const resolved = { ...(this.snapshot.value ?? {}) } as Record<string, unknown>
    if (removed) delete resolved[field]
    else resolved[field] = value
    this.snapshot = {
      ...this.snapshot,
      value: resolved as SectionValue,
      user: Object.keys(user).length === 0 ? undefined : user,
      revision: this.snapshot.revision === undefined ? 2 : this.snapshot.revision + 1,
    }
    for (const listener of this.listeners) listener()
  }
}

describe('CardForm projection', () => {
  it('projects the resolved value with no override and no draft', () => {
    const scope = new FakeScope({ rootDir: 'D:\\wt' }, { user: { rootDir: 'D:\\wt' } })
    const form = new CardForm(scope)
    expect(form.bind().getSnapshot()).toMatchObject({
      available: true, writable: true, rootDir: 'D:\\wt', overridden: true, dirty: false, saving: false, failed: false,
    })
  })

  it('marks the namespace unavailable while the scope is not ready', () => {
    const scope = new FakeScope({}, { status: 'unavailable' })
    const form = new CardForm(scope)
    expect(form.bind().getSnapshot().available).toBe(false)
  })

  it('reports read-only documents', () => {
    const scope = new FakeScope({}, { writable: false })
    const form = new CardForm(scope)
    expect(form.bind().getSnapshot().writable).toBe(false)
  })

  it('follows scope commits through the subscription', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    const store = form.bind()
    await scope.set('rootDir', '/data/wt')
    expect(store.getSnapshot().rootDir).toBe('/data/wt')
    expect(store.getSnapshot().overridden).toBe(true)
  })

  it('defaults the grouping switch on and follows live writes', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    const store = form.bind()
    expect(store.getSnapshot().groupSidebar).toBe(true)
    expect(store.getSnapshot().groupingPending).toBe(false)
    await form.actions().setGroupSidebar(false)
    expect(scope.writes).toEqual([{ op: 'set', field: 'groupSidebar', value: false }])
    expect(store.getSnapshot().groupSidebar).toBe(false)
    expect(store.getSnapshot().groupingPending).toBe(false)
    expect(store.getSnapshot().dirty).toBe(false)
    await form.actions().setGroupSidebar(true)
    expect(store.getSnapshot().groupSidebar).toBe(true)
  })

  it('flips the switch and marks pending before the write lands', async () => {
    const scope = new FakeScope({})
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const originalSet = scope.set.bind(scope)
    scope.set = async (field, value) => {
      await gate
      return originalSet(field, value)
    }
    const form = new CardForm(scope)
    const store = form.bind()
    const pending = form.actions().setGroupSidebar(false)
    const deadline = Date.now() + 500
    while (!store.getSnapshot().groupingPending && Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
    expect(store.getSnapshot()).toMatchObject({ groupSidebar: false, groupingPending: true, dirty: false })
    expect(scope.writes).toEqual([])
    release()
    await pending
    expect(store.getSnapshot()).toMatchObject({ groupSidebar: false, groupingPending: false })
    expect(scope.writes).toEqual([{ op: 'set', field: 'groupSidebar', value: false }])
  })

  it('keeps groupingPending until the seat callback settles on disable and enable', async () => {
    const scope = new FakeScope({})
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    const seen: boolean[] = []
    const form = new CardForm(scope, async (enabled) => {
      seen.push(enabled)
      await gate
    })
    const store = form.bind()

    const disable = form.actions().setGroupSidebar(false)
    const untilPending = Date.now() + 500
    while (!store.getSnapshot().groupingPending && Date.now() < untilPending) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
    const untilWrite = Date.now() + 500
    while (seen.length === 0 && Date.now() < untilWrite) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
    expect(seen).toEqual([false])
    expect(store.getSnapshot().groupingPending).toBe(true)
    release()
    await disable
    expect(store.getSnapshot().groupingPending).toBe(false)

    gate = new Promise<void>(resolve => { release = resolve })
    const enable = form.actions().setGroupSidebar(true)
    const untilEnable = Date.now() + 500
    while (seen.length < 2 && Date.now() < untilEnable) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
    expect(seen).toEqual([false, true])
    expect(store.getSnapshot().groupingPending).toBe(true)
    release()
    await enable
    expect(store.getSnapshot().groupingPending).toBe(false)
  })

  it('projects a stored off switch without staging', () => {
    const scope = new FakeScope({ groupSidebar: false }, { user: { groupSidebar: false } })
    const form = new CardForm(scope)
    expect(form.bind().getSnapshot()).toMatchObject({ groupSidebar: false, dirty: false })
  })
})

describe('CardForm staging', () => {
  it('stages an edit as dirty without writing', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editRoot('D:\\wt')
    expect(form.bind().getSnapshot()).toMatchObject({ rootDir: 'D:\\wt', dirty: true, overridden: true })
    expect(scope.writes).toEqual([])
  })

  it('previews a clear as the default location', () => {
    const scope = new FakeScope({ rootDir: 'D:\\wt' }, { user: { rootDir: 'D:\\wt' } })
    const form = new CardForm(scope)
    form.actions().clearRoot()
    expect(form.bind().getSnapshot()).toMatchObject({ rootDir: '', dirty: true, overridden: false })
  })

  it('discard drops the staged edit', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editRoot('D:\\wt')
    form.actions().discard()
    expect(form.bind().getSnapshot()).toMatchObject({ rootDir: '', dirty: false })
  })
})

describe('CardForm save', () => {
  it('stores a staged edit, verifies the landing, and clears the draft', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editRoot(' D:\\wt ')
    const store = form.bind()
    await form.actions().save()
    expect(scope.writes).toEqual([{ op: 'set', field: 'rootDir', value: 'D:\\wt' }])
    expect(store.getSnapshot()).toMatchObject({ rootDir: 'D:\\wt', dirty: false, overridden: true, failed: false })
  })

  it('clears the field (and the override) on an empty draft', async () => {
    const scope = new FakeScope({ rootDir: 'D:\\wt' }, { user: { rootDir: 'D:\\wt' } })
    const form = new CardForm(scope)
    form.actions().clearRoot()
    await form.actions().save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'rootDir', value: undefined }])
    expect(form.bind().getSnapshot()).toMatchObject({ rootDir: '', overridden: false, dirty: false })
  })

  it('flags a refused write and keeps the draft staged', async () => {
    const scope = new FakeScope({})
    scope.applyWrites = false
    const form = new CardForm(scope)
    form.actions().editRoot('D:\\wt')
    const store = form.bind()
    await form.actions().save()
    expect(store.getSnapshot()).toMatchObject({ rootDir: 'D:\\wt', dirty: true, failed: true })
  })

  it('clears the failure flag on the next edit', async () => {
    const scope = new FakeScope({})
    scope.applyWrites = false
    const form = new CardForm(scope)
    form.actions().editRoot('D:\\wt')
    await form.actions().save()
    expect(form.bind().getSnapshot().failed).toBe(true)
    form.actions().editRoot('E:\\wt')
    expect(form.bind().getSnapshot().failed).toBe(false)
  })
})
