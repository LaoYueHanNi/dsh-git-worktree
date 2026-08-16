/**
 * Full click reproduction: open a fresh New Session (blank), find the branch
 * chip, click it, verify the menu opens, and click another branch.
 * Run: node scripts/repro-click.mjs [port]
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3191'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', err => errors.push(`[pageerror] ${err.message.slice(0, 400)}`))
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text().slice(0, 400)}`)
})

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

// 1. Open a fresh New Session (forces the blank hero state).
await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)
await page.screenshot({ path: 'scripts/repro-1-hero.png' })

// 2. Locate our row: the toggle button (工作树 / Worktree).
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const toggleCount = await toggle.count()
console.log(`toggle count: ${toggleCount}`)

// 3. The branch chip is its preceding sibling button.
let chip = null
if (toggleCount > 0) {
  chip = toggle.locator('xpath=preceding-sibling::button[1]')
  console.log('chip text:', JSON.stringify((await chip.textContent())?.trim()))
} else {
  // Fallback: dump the whole dock area HTML for inspection.
  const html = await page.evaluate(() => {
    const composer = document.querySelector('[class*="composerStack"], [class*="composer"]')
    return composer?.outerHTML.slice(0, 1200) ?? '(composer not found)'
  })
  console.log('--- composer html ---')
  console.log(html)
}

// 4. Click the chip and check for a portal menu in document.body.
if (chip !== null && await chip.count() > 0) {
  await chip.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'scripts/repro-2-clicked.png' })
  const menu = await page.evaluate(() => {
    // Portal menus land directly under body (fixed-positioned card).
    for (const el of document.body.children) {
      if (el.getAttribute('style')?.includes('fixed') || el.querySelector('[role="listbox"]') !== null) {
        const text = el.textContent?.slice(0, 200) ?? ''
        if (text.trim() !== '') return text
      }
    }
    return null
  })
  console.log('menu text after click:', menu === null ? '(NO MENU)' : JSON.stringify(menu))
}

console.log('--- errors ---')
console.log(errors.length === 0 ? '(none)' : errors.join('\n'))
await browser.close()
