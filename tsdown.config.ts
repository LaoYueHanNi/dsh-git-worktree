import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'tsdown'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Plugin id stamped into the loader handoff and the injected style tags.
 * Derived from package.json so the bundle's registration id always equals
 * the installed package name — the web shell rejects a bundle whose
 * `__ModuleLoader__.load` id differs from the loader entry's package.
 */
const PLUGIN_ID: string = createRequire(import.meta.url)('./package.json').name

/**
 * CSS Modules stylesheet collection: new DSH hosts (0.2.2+ client-module-metadata)
 * read `meta().stylesheets` and own `<style>` mount/unmount lifecycle; legacy
 * hosts that ignore `meta` fall back to mounting `<style data-plugin-css>` inside
 * `ctx.effect` so styles are removed on plugin dispose.
 */
const CSS_VIRTUAL_PREFIX = '\0git-worktree-css:'
const CSS_VIRTUAL_SUFFIX = '?inline'

interface CompiledStylesheet {
  readonly path: string
  readonly tagId: string
  readonly css: string
}

const compiledStyles = new Map<string, CompiledStylesheet>()

function cssModulesInline(pluginId: string): Plugin {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const base = importer !== undefined ? join(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + base + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId, 'utf8')
      // Minimal CSS Modules transform: hash the file, scope each `.class`.
      const hash = String(Math.abs([...fileId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)))
      const classMap: Record<string, string> = {}
      const css = source.replace(/\.([A-Za-z_][\w-]*)/g, (match, local: string) => {
        const scoped = `${local}_${hash}`
        if (classMap[local] === undefined) classMap[local] = scoped
        return `.${scoped}`
      })
      const relPath = relative(PACKAGE_DIR, fileId).replace(/\\/g, '/')
      const tagId = `${pluginId}/${basename(fileId)}`
      compiledStyles.set(virtualId, { path: relPath, tagId, css })
      return {
        code: `export default ${JSON.stringify(classMap)};`,
        moduleSideEffects: 'no-treeshake' as const,
      }
    },
  }
}

/**
 * Browser platform words shared by the shell's frozen module table: these stay
 * external so the factory's `require` resolves them from the table at runtime.
 * 0.1.2 table: react / jsx / react-dom / cordis / ui-slots / primitives.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig({
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // The browser bundle lands beside the tsc host output in lib/; clean must
  // stay off or tsdown would wipe the host half.
  outDir: 'lib',
  entryFileNames: undefined,
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  external: [...CLIENT_EXTERNALS],
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [cssModulesInline(PLUGIN_ID)],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load((() => { const __dsh_id = ${JSON.stringify(PLUGIN_ID)}; let __dsh_meta_used = false; const __dsh_factory = (require) => {`,
    footer(chunk: { modules: Record<string, unknown> }) {
      const entries: CompiledStylesheet[] = []
      for (const moduleId of Object.keys(chunk.modules)) {
        const sheet = compiledStyles.get(moduleId)
        if (sheet !== undefined) entries.push(sheet)
      }
      entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      const serialized = JSON.stringify(entries.map(e => [e.path, e.tagId, e.css]))
      return `const __dsh_exports = module.exports; const __dsh_result = (__dsh_exports && typeof __dsh_exports.apply === 'function') ? Object.assign({}, __dsh_exports, { apply(ctx, config) { if (!__dsh_meta_used && typeof document !== 'undefined' && ctx && typeof ctx.effect === 'function') { ctx.effect(() => { if (__dsh_meta_used) return () => {}; const mounted = []; for (const [, tagId, css] of __dsh_sheets) { if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) { const tag = document.createElement('style'); tag.dataset.plugin = __dsh_id; tag.dataset.pluginCss = tagId; tag.textContent = css; document.head.appendChild(tag); mounted.push(tag); } } return () => { for (const tag of mounted) tag.remove(); }; }, 'git-worktree: fallback stylesheets'); } return __dsh_exports.apply.call(this, ctx, config); } }) : __dsh_exports; return __dsh_result; }; const __dsh_sheets = ${serialized}; const __dsh_remove_fallback = () => { if (typeof document === 'undefined') return; for (const [, tagId] of __dsh_sheets) { const el = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']'); if (el) el.remove(); } }; return { id: __dsh_id, meta: () => { __dsh_meta_used = true; __dsh_remove_fallback(); const stylesheets = {}; for (const [path, , css] of __dsh_sheets) stylesheets[path] = { text: () => css }; return { stylesheets }; }, factory: __dsh_factory }; })());`
    },
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
