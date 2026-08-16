/** Probe which input-region slots render in the hero phase. Run: node scripts/probe-slots.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3191'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)

const report = await page.evaluate(() => {
  const slots = {}
  for (const el of document.querySelectorAll('[data-slot]')) {
    const key = el.getAttribute('data-slot')
    const rendered = el.childNodes.length > 0
    slots[key] = rendered ? 'HAS CONTENT' : 'empty'
  }
  return slots
})
console.log('hero-phase slot outlets:')
for (const [key, state] of Object.entries(report)) console.log(`  ${key}: ${state}`)

// Does the tool row exist with its resident chrome (permission select etc.)?
const toolsText = await page.evaluate(() => {
  for (const el of document.querySelectorAll('button')) {
    const text = (el.textContent ?? '').trim()
    if (text === 'Workspace Write' || text.includes('写入')) {
      return `permission chip present: "${text}" (tool row renders in hero)`
    }
  }
  return 'permission chip absent'
})
console.log(toolsText)
await browser.close()
