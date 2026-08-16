/** Verify the mid-trunk merge icon: branch path ends at y=4.3, top dot separate at y=2. Run: node scripts/probe-icon2.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3193'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2500)

const info = await page.evaluate(() => {
  for (const svg of document.querySelectorAll('svg')) {
    const circles = svg.querySelectorAll('circle')
    if (circles.length >= 4) {
      const path = svg.querySelector('path')
      return {
        dots: [...circles].map(c => c.getAttribute('cy')).join(','),
        pathEnd: (path?.getAttribute('d') ?? '').slice(-24),
      }
    }
  }
  return null
})
console.log(JSON.stringify(info))
await page.screenshot({ path: 'scripts/probe-icon2.png' })
await browser.close()
