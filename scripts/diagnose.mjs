/**
 * Headless-browser diagnosis pass 2: dump the dock row DOM, screenshot it,
 * and try clicking the branch chip. Run: node scripts/diagnose.mjs [port].
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3191'
const exe = process.env.PLAYWRIGHT_CHROMIUM
  ?? `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`[console.${msg.type()}] ${msg.text().slice(0, 300)}`)
})
page.on('pageerror', err => errors.push(`[pageerror] ${err.message.slice(0, 300)}`))

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(4000)

// Find elements carrying our CSS-module tag (style[data-plugin-css] was injected).
const styleTag = await page.evaluate(() => {
  const tag = document.querySelector('style[data-plugin*="git-worktree"]')
  return tag !== null
})
console.log(`plugin css injected: ${styleTag}`)

// Dump every element containing the Worktree toggle label.
const toggleInfo = await page.evaluate(() => {
  const hits = []
  for (const el of document.querySelectorAll('button, span')) {
    const text = (el.textContent ?? '').trim()
    if (text === 'Worktree' || text === '工作树') {
      hits.push({
        tag: el.tagName,
        text,
        parentHtml: el.parentElement?.outerHTML.slice(0, 400) ?? '',
      })
    }
  }
  return hits
})
for (const hit of toggleInfo) {
  console.log(`--- toggle hit <${hit.tag}> "${hit.text}" ---`)
  console.log(hit.parentHtml)
}

await page.screenshot({ path: 'scripts/diagnose.png' })
console.log('screenshot: scripts/diagnose.png')

// Try clicking the branch chip (the button left of the toggle inside the same row).
const row = page.locator('button', { hasText: 'Worktree' }).first()
const chipButton = row.locator('xpath=preceding-sibling::button[1]')
if (await chipButton.count() > 0) {
  console.log('chip button found:', JSON.stringify(await chipButton.textContent()))
  await chipButton.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'scripts/diagnose-clicked.png' })
  const menuVisible = await page.evaluate(() => {
    const list = document.querySelector('[role="listbox"], [role="menu"]')
    return list !== null ? list.outerHTML.slice(0, 300) : null
  })
  console.log('menu after click:', menuVisible ?? '(none)')
} else {
  console.log('chip button NOT found next to toggle')
}

await browser.close()
console.log('--- errors ---')
console.log(errors.length === 0 ? '(none)' : errors.slice(0, 10).join('\n'))
