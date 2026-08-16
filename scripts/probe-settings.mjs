/** Verify the settings section renders the browse button next to save. Run: node scripts/probe-settings.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3201'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

// Open settings, then our section.
await page.getByText('设置').first().click()
await page.waitForTimeout(800)
const navHit = page.getByText('Git 工作树', { exact: false }).last()
if (await navHit.count() > 0) {
  await navHit.click()
  await page.waitForTimeout(800)
}
const out = await page.evaluate(() => {
  const input = document.querySelector('#git-worktree-root-dir')
  const section = input?.closest('div[class*="body"], div[class*="section"]') ?? document.body
  const buttons = [...(section?.querySelectorAll('button') ?? [])].map(b => ({
    text: b.textContent?.trim() || '(icon)',
    title: b.getAttribute('title') ?? '',
    hasFolderIcon: b.querySelector('svg') !== null,
  }))
  return {
    inputPresent: input !== null,
    inputPlaceholder: input?.getAttribute('placeholder') ?? '',
    buttons,
  }
})
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: 'scripts/settings.png' })
await browser.close()
