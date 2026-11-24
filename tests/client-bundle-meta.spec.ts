/**
 * Verifies the built browser bundle (`lib/client.js`) against both DSH client
 * stylesheet protocols in pure Node (no jsdom dependency):
 *   1. New hosts (DSH 0.2.2+ client-module-metadata / DocumentStyles): consume
 *      `manifest.meta().stylesheets` without leaving any fallback `<style data-plugin-css>`.
 *   2. Legacy hosts: ignore `meta`, mount fallback `<style data-plugin-css>`
 *      inside `ctx.effect`, and remove them on dispose.
 *   3. Mixed order (`apply()` before `meta()`): invoking `meta()` removes
 *      previously mounted fallback `<style>` elements.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface LoadedManifest {
  readonly id: string
  readonly meta?: () => {
    readonly stylesheets?: Record<string, { readonly text: (ctx: { asset: (ref: string) => string }) => string }>
  }
  readonly factory: (require: (specifier: string) => unknown) => {
    readonly inject?: readonly string[]
    readonly apply?: (ctx: unknown, config?: unknown) => void
  }
}

interface FakeStyleEl {
  dataset: Record<string, string>
  textContent: string
  remove: () => void
}

const BUNDLE_PATH = resolve(import.meta.dirname, '..', 'lib', 'client.js')
const PLUGIN_ID = '@laoyuehanni/dsh-git-worktree'

function installFakeDom(): { tags: FakeStyleEl[] } {
  const tags: FakeStyleEl[] = []
  const fakeDocument = {
    head: {
      appendChild(el: FakeStyleEl) {
        tags.push(el)
        return el
      },
    },
    createElement() {
      const el: FakeStyleEl = {
        dataset: {},
        textContent: '',
        remove() {
          const idx = tags.indexOf(el)
          if (idx >= 0) tags.splice(idx, 1)
        },
      }
      return el
    },
    querySelector(selector: string): FakeStyleEl | null {
      const match = /^style\[data-plugin-css="(.+)"\]$/.exec(selector)
      if (match === null) return null
      const tagId = match[1]
      return tags.find(tag => tag.dataset.pluginCss === tagId) ?? null
    },
  }
  vi.stubGlobal('document', fakeDocument)
  return { tags }
}

function evaluateBundle(): LoadedManifest {
  const code = readFileSync(BUNDLE_PATH, 'utf8')
  let captured: LoadedManifest | undefined
  vi.stubGlobal('window', {
    __ModuleLoader__: {
      load(manifest: LoadedManifest) {
        captured = manifest
      },
    },
  })
  new Function(code)()
  if (captured === undefined) throw new Error('bundle did not invoke __ModuleLoader__.load')
  return captured
}

function stubPlatformRequire(specifier: string): unknown {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  return {}
}

function createFakeClientContext(): { ctx: Record<string, unknown>; dispose: () => void } {
  const cleanups: Array<() => void> = []
  const ctx: Record<string, unknown> = {
    locale: { register: vi.fn(() => () => {}) },
    slots: { inject: vi.fn(() => () => {}), register: vi.fn(() => () => {}) },
    workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }) } },
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    uiWorkspace: { startSession: vi.fn() },
    remote: { $host: { home: '/home/x', isLoopback: true } },
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: {}, user: undefined, writable: true }),
        subscribe: () => () => {},
        set: async () => true,
        unset: async () => true,
      }),
      describe: () => ({
        getSnapshot: () => ({ status: 'ready', view: { namespaces: [] } }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
    },
    effect(fn: () => (() => void) | void) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  return {
    ctx,
    dispose() {
      while (cleanups.length > 0) cleanups.pop()?.()
    },
  }
}

describe.skipIf(!existsSync(BUNDLE_PATH))('built client bundle client-module-metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes meta().stylesheets and skips fallback DOM injection on new hosts', () => {
    const { tags } = installFakeDom()
    const manifest = evaluateBundle()
    expect(manifest.id).toBe(PLUGIN_ID)
    expect(typeof manifest.meta).toBe('function')

    const meta = manifest.meta!()
    const sheets = meta.stylesheets ?? {}
    const paths = Object.keys(sheets)
    expect(paths).toContain('src/client/BranchChip.module.css')
    expect(paths).toContain('src/client/GitWorktreeCard.module.css')
    expect(paths.length).toBeGreaterThanOrEqual(6)
    for (const path of paths) {
      expect(sheets[path]!.text({ asset: ref => ref }).length).toBeGreaterThan(0)
    }

    const exports = manifest.factory(stubPlatformRequire)
    const { ctx, dispose } = createFakeClientContext()
    exports.apply?.(ctx)
    expect(tags.length).toBe(0)
    dispose()
  })

  it('mounts fallback styles on legacy hosts and cleans them up on dispose', () => {
    const { tags } = installFakeDom()
    const manifest = evaluateBundle()
    const exports = manifest.factory(stubPlatformRequire)
    const { ctx, dispose } = createFakeClientContext()

    exports.apply?.(ctx)
    expect(tags.length).toBeGreaterThanOrEqual(6)
    expect(tags.every(el => el.dataset.plugin === PLUGIN_ID)).toBe(true)

    dispose()
    expect(tags.length).toBe(0)
  })

  it('removes already-mounted fallback styles if meta() is invoked after apply()', () => {
    const { tags } = installFakeDom()
    const manifest = evaluateBundle()
    const exports = manifest.factory(stubPlatformRequire)
    const { ctx, dispose } = createFakeClientContext()

    exports.apply?.(ctx)
    expect(tags.length).toBeGreaterThanOrEqual(6)

    const meta = manifest.meta!()
    expect(Object.keys(meta.stylesheets ?? {}).length).toBeGreaterThanOrEqual(6)
    expect(tags.length).toBe(0)
    dispose()
  })
})
