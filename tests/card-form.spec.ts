import { describe, expect, it } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, type SectionValue } from '../src/client/card-form.ts'

/**
 * Scripted config form: snapshots the form reads, plus the writes it
 * should land. `applyWrites` (default true) makes a write update the user
 * layer exactly as the Host would; turning it off scripts a refusal (the
 * write crossed the wire but nothing stored).
 */
class FakeScope implements ConfigForm<SectionValue> {
  private snapshot: ConfigFormSnapshot<SectionValue>
  private readonly listeners = new Set<() => void>()
  readonly writes: Array<{ op: 'set' | 'unset'; field: string; value: unknown }> = []
  applyWrites = true

  constructor(section: SectionValue = {}, over: Partial<ConfigFormSnapshot<SectionValue>> = {}) {
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

  getSnapshot(): ConfigFormSnapshot<SectionValue> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(): Promise<boolean> {
    return true
  }

  async set(field: string, value: unknown): Promise<boolean> {
    this.writes.push({ op: 'set', field, value })
    if (this.applyWrites) this.replaceUser({ ...this.userRecord(), [field]: value }, field, value)
    return true
  }

  async unset(field: string): Promise<boolean> {
    this.writes.push({ op: 'unset', field, value: undefined })
    if (this.applyWrites) {
      const next = this.userRecord()
      delete next[field]
      this.replaceUser(next, field, undefined, true)
    }
    return true
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
  it('projects the resolved root value with its override mark, read-only', () => {
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
  it('stages a keep-cap edit as dirty without writing', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('12')
    expect(form.bind().getSnapshot()).toMatchObject({ keepWorktreesText: '12', dirty: true })
    expect(scope.writes).toEqual([])
  })

  it('discard drops the staged keep draft', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('12')
    form.actions().discard()
    expect(form.bind().getSnapshot()).toMatchObject({ keepWorktreesText: '30', dirty: false })
  })
})

describe('CardForm save', () => {
  it('refuses to save with nothing staged', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    await form.actions().save()
    expect(scope.writes).toEqual([])
    expect(form.bind().getSnapshot().dirty).toBe(false)
  })

  it('clears the failure flag on the next edit', async () => {
    const scope = new FakeScope({})
    scope.applyWrites = false
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('12')
    await form.actions().save()
    expect(form.bind().getSnapshot().failed).toBe(true)
    form.actions().editKeepWorktrees('9')
    expect(form.bind().getSnapshot().failed).toBe(false)
  })
})

describe('CardForm write-through switches', () => {
  it('defaults the fetch and prune switches off and persists flips immediately', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    const store = form.bind()
    expect(store.getSnapshot()).toMatchObject({ fetchBeforeCreate: false, autoPruneWorktrees: false })
    await form.actions().setFetchBeforeCreate(true)
    await form.actions().setAutoPruneWorktrees(true)
    expect(scope.writes).toEqual([
      { op: 'set', field: 'fetchBeforeCreate', value: true },
      { op: 'set', field: 'autoPruneWorktrees', value: true },
    ])
    expect(store.getSnapshot()).toMatchObject({ fetchBeforeCreate: true, autoPruneWorktrees: true, dirty: false })
  })

  it('keeps the keep-cap default at 30 and reports it usable', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    expect(form.bind().getSnapshot()).toMatchObject({ keepWorktreesText: '30', keepWorktreesValid: true, dirty: false })
  })

  // The card invokes these from a checkbox onChange that drops the promise:
  // a rejection must become visible state, never an unhandled rejection.
  it('records a rejected simple-flag write instead of rethrowing', async () => {
    const scope = new FakeScope({})
    scope.set = () => Promise.reject(new Error('document locked'))
    const form = new CardForm(scope)
    const store = form.bind()
    await expect(form.actions().setFetchBeforeCreate(true)).resolves.toBeUndefined()
    expect(store.getSnapshot().switchFailed).toBe('fetchBeforeCreate')
  })

  it('clears the switch failure once the same switch writes successfully', async () => {
    const scope = new FakeScope({})
    const realSet = scope.set.bind(scope)
    scope.set = () => Promise.reject(new Error('document locked'))
    const form = new CardForm(scope)
    const store = form.bind()
    await form.actions().setAutoPruneWorktrees(true)
    expect(store.getSnapshot().switchFailed).toBe('autoPruneWorktrees')
    scope.set = realSet
    await form.actions().setAutoPruneWorktrees(true)
    expect(store.getSnapshot()).toMatchObject({ switchFailed: null, autoPruneWorktrees: true })
  })

  it('reports no switch failure on a clean card', () => {
    const scope = new FakeScope({})
    expect(new CardForm(scope).bind().getSnapshot().switchFailed).toBeNull()
  })
})

describe('CardForm keep-cap staging', () => {
  it('stages a numeric edit as dirty without writing', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('12')
    expect(form.bind().getSnapshot()).toMatchObject({ keepWorktreesText: '12', keepWorktreesValid: true, dirty: true })
    expect(scope.writes).toEqual([])
  })

  it('marks a non-integer draft unusable', () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('2.5')
    expect(form.bind().getSnapshot()).toMatchObject({ keepWorktreesText: '2.5', keepWorktreesValid: false, dirty: true })
    form.actions().editKeepWorktrees('0')
    expect(form.bind().getSnapshot().keepWorktreesValid).toBe(false)
    form.actions().editKeepWorktrees('abc')
    expect(form.bind().getSnapshot().keepWorktreesValid).toBe(false)
  })

  it('refuses to save while the keep draft is unusable', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('0')
    await form.actions().save()
    expect(scope.writes).toEqual([])
    expect(form.bind().getSnapshot().keepWorktreesText).toBe('0')
  })

  it('stores a staged keep edit, verifies the landing, and clears the draft', async () => {
    const scope = new FakeScope({ autoPruneWorktrees: true })
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees(' 12 ')
    const store = form.bind()
    await form.actions().save()
    expect(scope.writes).toEqual([{ op: 'set', field: 'keepWorktrees', value: 12 }])
    expect(store.getSnapshot()).toMatchObject({ keepWorktreesText: '12', dirty: false, failed: false })
  })

  it('flags a refused keep write and keeps the draft staged', async () => {
    const scope = new FakeScope({})
    scope.applyWrites = false
    const form = new CardForm(scope)
    form.actions().editKeepWorktrees('12')
    const store = form.bind()
    await form.actions().save()
    expect(store.getSnapshot()).toMatchObject({ keepWorktreesText: '12', dirty: true, failed: true })
  })

  it('stages postCreateCopyFiles draft, cleans whitespace and empty lines on save', async () => {
    const scope = new FakeScope({})
    const form = new CardForm(scope)
    const store = form.bind()
    expect(store.getSnapshot().postCreateCopyFilesText).toBe('')

    form.actions().editPostCreateCopyFiles('  .env  \n\nconfig/secrets.json\n  \n')
    expect(store.getSnapshot()).toMatchObject({
      postCreateCopyFilesText: '  .env  \n\nconfig/secrets.json\n  \n',
      dirty: true,
    })

    await form.actions().save()
    expect(scope.writes).toEqual([
      { op: 'set', field: 'postCreateCopyFiles', value: ['.env', 'config/secrets.json'] },
    ])
    expect(store.getSnapshot().dirty).toBe(false)
    expect(store.getSnapshot().postCreateCopyFilesText).toBe('.env\nconfig/secrets.json')
  })

  it('drops postCreateCopyFiles draft on discard', () => {
    const scope = new FakeScope({ postCreateCopyFiles: ['.env'] })
    const form = new CardForm(scope)
    const store = form.bind()
    expect(store.getSnapshot().postCreateCopyFilesText).toBe('.env')

    form.actions().editPostCreateCopyFiles('.env\n.env.local')
    expect(store.getSnapshot().dirty).toBe(true)

    form.actions().discard()
    expect(store.getSnapshot()).toMatchObject({
      postCreateCopyFilesText: '.env',
      dirty: false,
    })
  })
})
