/**
 * Minimal end-to-end UI check, no filesystem side trips: fill the input,
 * blur, catch the PUT response, read the inline status note.
 * Prerequisite: server started with rootDir at the default (empty).
 * Run: node scripts/probe-settings3.mjs [port]
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3214'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
try {
  const putDone = page.waitForResponse(
    res => res.url().includes('/plugin/git-worktree/settings') && res.request().method() === 'PUT',
    { timeout: 15000 },
  ).then(res => res.status())

  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(3500)
  await page.getByText('设置').first().click()
  await page.waitForTimeout(800)
  const navHit = page.getByText('Git 工作树', { exact: false }).last()
  if (await navHit.count() > 0) {
    await navHit.click()
    await page.waitForTimeout(800)
  }

  const initial = await page.inputValue('#git-worktree-root-dir')
  await page.fill('#git-worktree-root-dir', 'D:\\ui-final-probe')
  await page.evaluate(() => { document.activeElement?.blur() })
  const putStatus = await putDone
  await page.waitForTimeout(400)
  const savedShown = await page.evaluate(
    () => /已保存|Saved/.test(
      document.querySelector('#git-worktree-root-dir')?.closest('div[class*="row"]')?.textContent ?? '',
    ),
  )
  await page.waitForTimeout(1600)
  const savedGone = await page.evaluate(
    () => !/已保存|Saved/.test(
      document.querySelector('#git-worktree-root-dir')?.closest('div[class*="row"]')?.textContent ?? '',
    ),
  )
  console.log(JSON.stringify({ initial, putStatus, savedShown, savedGone }, null, 1))
} finally {
  await browser.close()
}
