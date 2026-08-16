/** End-to-end: chip → menu → pick a branch → confirm dialog appears. Run: node scripts/probe-flow.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3191'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', err => errors.push(`[pageerror] ${err.message.slice(0, 300)}`))

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2500)

// Create a throwaway branch so the menu has a second selectable row.
// (The repo under test is this plugin checkout itself.)
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
await chip.click()
await page.waitForTimeout(600)

const menuItems = await page.locator('[role="menuitem"]').allTextContents()
console.log('menu rows:', JSON.stringify(menuItems))

// Pick any row that is not the current branch and not disabled.
const target = page.locator('[role="menuitem"]:not([disabled])').filter({ hasText: /^((?!main).)$/ }).first()
if ((await page.locator('[role="menuitem"]:not([disabled])').count()) > 1) {
  const rows = page.locator('[role="menuitem"]:not([disabled])')
  const texts = await rows.allTextContents()
  const pick = texts.find(t => t.trim() !== 'main')
  if (pick !== undefined) {
    await rows.filter({ hasText: pick }).first().click()
    await page.waitForTimeout(600)
    const dialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return dlg === null ? null : (dlg.textContent ?? '').slice(0, 150)
    })
    console.log('pick:', JSON.stringify(pick))
    console.log('dialog:', dialog === null ? '(none)' : JSON.stringify(dialog))
    await page.screenshot({ path: 'scripts/probe-flow.png' })
  }
} else {
  console.log('only the current branch is selectable — creating no side branch here; dialog step skipped')
}

console.log('errors:', errors.length === 0 ? '(none)' : errors.join(' | '))
await browser.close()
