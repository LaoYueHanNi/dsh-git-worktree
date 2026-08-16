import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'tsdown'

/**
 * CSS Modules inlining: the web shell has no CSS pipeline, so every
 * `*.module.css` import compiles to a `<style data-plugin-css>` tag injected
 * once per document plus a default-exported class map. Mirrors the official
 * dsh client build's plugin.
 */
const CSS_VIRTUAL_PREFIX = '\0git-worktree-css:'
const CSS_VIRTUAL_SUFFIX = '?inline'

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
      const tagId = `${pluginId}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css="\' + tagId + \'"]\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

/**
 * Browser platform words shared by the shell's frozen module table: these stay
 * external so the factory's `require` resolves them from the table at runtime.
 * Mirrors the platform list in @deepseek-ai/dsh-client-web/src/platform.ts plus
 * the runtime client exemption (runtime registers its factory before any
 * dependent bundle materializes).
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default defineConfig({
  name: 'dsh-git-worktree/client',
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
  plugins: [cssModulesInline('dsh-git-worktree')],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-git-worktree", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
