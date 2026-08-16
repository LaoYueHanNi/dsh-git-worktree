/** Click the chip, then dump everything portal-mounted under body. Run: node scripts/probe-menu.mjs [port] */
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

const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
console.log('chip:', JSON.stringify((await chip.textContent())?.trim()))

const before = await page.evaluate(() => document.body.children.length)
await chip.click()
await page.waitForTimeout(700)
const after = await page.evaluate(() => document.body.children.length)
console.log(`body children: ${before} → ${after}`)

const portalDump = await page.evaluate(() => {
  const out = []
  for (const el of document.body.children) {
    const html = el.outerHTML
    if (html.includes('menu') || html.includes('listbox') || html.includes('main</') || html.includes('>main<') || html.includes('feat')) {
      out.push(html.slice(0, 300))
    }
  }
  return out
})
console.log('portal hits:', portalDump.length)
for (const hit of portalDump) console.log('---\n' + hit)

await page.screenshot({ path: 'scripts/probe-menu.png', fullPage: false })
console.log('screenshot saved')
console.log('errors:', errors.length === 0 ? '(none)' : errors.join(' | '))
await browser.close()
