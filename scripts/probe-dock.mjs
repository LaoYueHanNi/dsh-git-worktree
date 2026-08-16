/** Dump the dock row's actual content and trace the status fetch. Run: node scripts/probe-dock.mjs [port] */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3191'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
const fetches = []
page.on('response', res => {
  if (res.url().includes('git-worktree')) {
    fetches.push(`${res.status()} ${res.url().slice(0, 120)} → ${res.url().includes('status') ? '' : ''}`)
  }
})
page.on('requestfailed', req => {
  if (req.url().includes('git-worktree')) fetches.push(`FAILED ${req.url().slice(0, 120)} (${req.failure()?.errorText})`)
})

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2500)

const dockHtml = await page.evaluate(() => {
  const el = document.querySelector('[data-slot="conversation.input.dock"]')
  return el?.innerHTML.slice(0, 800) ?? '(dock outlet absent)'
})
console.log('--- dock inner html ---')
console.log(dockHtml)
console.log('--- git-worktree fetches ---')
console.log(fetches.length === 0 ? '(none)' : fetches.join('\n'))
await browser.close()
