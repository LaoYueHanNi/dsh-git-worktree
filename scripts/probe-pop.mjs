/** Verify the confirm bubble: appears below the chip (not a centered modal), Menu-like card, cancel/confirm work. Run: node scripts/probe-pop.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3199'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', err => errors.push(`[pageerror] ${err.message.slice(0, 300)}`))

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2500)

const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
const chipRect = await chip.boundingBox()

await chip.click()
await page.waitForTimeout(500)
const rows = page.locator('[role="menuitem"]:not([disabled])')
const texts = await rows.allTextContents()
const pick = texts.find(t => t.trim() !== 'main')
await rows.filter({ hasText: pick ?? '' }).first().click()
await page.waitForTimeout(500)

const pop = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  if (dlg === null) return null
  const r = dlg.getBoundingClientRect()
  const s = getComputedStyle(dlg)
  const ask = dlg.querySelector('p')
  const buttons = [...dlg.querySelectorAll('button')].map(b => b.textContent?.trim())
  return {
    rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) },
    radius: s.borderRadius,
    ask: ask?.textContent?.trim() ?? '',
    buttons,
  }
})
console.log('chip rect:', JSON.stringify(chipRect && { x: Math.round(chipRect.x), y: Math.round(chipRect.y), w: Math.round(chipRect.width) }))
console.log('pop:', JSON.stringify(pop))

// Confirm executes (switch back after).
const confirmBtn = page.locator('[role="dialog"] button').nth(1)
await confirmBtn.click()
await page.waitForTimeout(1500)
const after = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  return dlg === null ? '(closed — action ran)' : 'still open'
})
console.log('after confirm:', after)
console.log('errors:', errors.length === 0 ? '(none)' : errors.join(' | '))
await browser.close()
