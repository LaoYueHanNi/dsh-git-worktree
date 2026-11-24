import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  icon?: string
  files?: string[]
  engines?: { node?: string; dsh?: string }
}

describe('插件图标与 DSH 引擎元数据', () => {
  it('package.json 声明顶层 icon、engines.dsh 且 files 收录 icon.svg', () => {
    expect(pkg.icon).toBe('./icon.svg')
    expect(pkg.files).toContain('icon.svg')
    expect(pkg.engines?.dsh).toBe('>=0.2.0-rc.1')
  })

  it('icon.svg 存在、在 256 KiB 上限内且符合自包含几何 SVG 规范', () => {
    const iconPath = join(repoRoot, 'icon.svg')
    const bytes = statSync(iconPath).size
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThanOrEqual(256 * 1024)

    const svg = readFileSync(iconPath, 'utf8')
    expect(svg).toMatch(/width="36"/)
    expect(svg).toMatch(/height="36"/)
    expect(svg).toMatch(/viewBox="0 0 36 36"/)
    // DSH 插件管理页以图片方式加载图标，禁止脚本、外链、样式块与文本节点。
    expect(svg).not.toMatch(/<(?:script|style|text|image|foreignObject)\b/i)
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i)
  })
})
