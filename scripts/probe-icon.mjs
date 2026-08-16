/** Verify the new git-graph icon renders (13px svg with trunk+dots) and the menu flow still works. Run: node scripts/probe-icon.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3192'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', err => errors.push(`[pageerror] ${err.message.slice(0, 300)}`))

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2500)

// The chip's icon: our inline svg (has circles), 13px.
const iconInfo = await page.evaluate(() => {
  for (const svg of document.querySelectorAll('svg')) {
    if (svg.querySelectorAll('circle').length >= 4) {
      const rect = svg.getBoundingClientRect()
      const firstDot = svg.querySelector('circle')
      const line = svg.querySelector('line')
      const path = svg.querySelector('path')
      return {
        size: `${rect.width}x${rect.height}`,
        circles: svg.querySelectorAll('circle').length,
        trunk: line !== null
          ? `x=${line.getAttribute('x1')} y1=${line.getAttribute('y1')} y2=${line.getAttribute('y2')}`
          : '(none)',
        branch: path !== null ? (path.getAttribute('d') ?? '').slice(0, 60) : '(none)',
        bottomDot: firstDot !== null ? `cy=${firstDot.getAttribute('cy')}` : '(none)',
      }
    }
  }
  return null
})
console.log('git-graph icon:', JSON.stringify(iconInfo, null, 1))

// Full flow regression: chip → menu → rows present.
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
await chip.click()
await page.waitForTimeout(600)
const rows = await page.locator('[role="menuitem"]').allTextContents()
console.log('menu rows:', JSON.stringify(rows))
await page.screenshot({ path: 'scripts/probe-icon.png' })
console.log('errors:', errors.length === 0 ? '(none)' : errors.join(' | '))
await browser.close()
