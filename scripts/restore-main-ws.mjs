/** One-off: activate a session of the MAIN repo workspace so the 新会话
 * button targets the main repo again (it follows the active workspace). */
import { chromium } from 'playwright-core'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
// Expand the main repo workspace group.
await page.getByText('dsh-token-usage', { exact: true }).first().click()
await page.waitForTimeout(800)
// Open its first session (the composer turns into a started session of the
// main repo; the chip menu there is unlocked).
await page.getByText('详细分析当前项目').first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'scripts/restore-1.png' })
await browser.close()
console.log('clicked main-repo session (see scripts/restore-1.png)')
