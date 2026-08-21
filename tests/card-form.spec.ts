import { describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
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
