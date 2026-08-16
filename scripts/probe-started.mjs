/**
 * Posture split end-to-end: open a STARTED session from the sidebar — the
 * chip stays interactive but the worktree toggle segment is gone (one
 * button). Then confirm the menu still opens there.
 * Run: node scripts/probe-started.mjs [port]
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3216'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', err => errors.push(err.message.slice(0, 200)))
try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(4000)

  // Hop into a STARTED session (any titled row in the workspaces sidebar).
  const startedRow = page.locator('[data-slot="sidebar.workspaces"]').getByText('测试', { exact: true })
  if (await startedRow.count() === 0) {
    console.log('no started session row found')
  } else {
    await startedRow.first().click()
    await page.waitForTimeout(1500)
  }

  const posture = await page.evaluate(() => {
    const outlet = document.querySelector('[data-slot="conversation.input.left"]')
    return {
      chipButtons: outlet?.querySelectorAll('button').length ?? 0,
      hasWorktreeLabel: (outlet?.textContent ?? '').includes('工作树'),
      branchText: outlet?.textContent?.trim().slice(0, 30) ?? '',
    }
  })

  const chip = page.locator('[data-slot="conversation.input.left"] button').first()
  let menuOpened = false
  let menuLabel = ''
  if (await chip.count() > 0) {
    await chip.click()
    await page.waitForTimeout(600)
    const menu = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]')
      return m === null ? null : m.textContent?.slice(0, 60)
    })
    menuOpened = menu !== null
    menuLabel = menu ?? ''
  }
  console.log(JSON.stringify({
    posture,
    toggleGone: !posture.hasWorktreeLabel && posture.chipButtons === 1,
    menuOpened,
    menuLabel,
    errors,
  }, null, 1))
} finally {
  await browser.close()
}
