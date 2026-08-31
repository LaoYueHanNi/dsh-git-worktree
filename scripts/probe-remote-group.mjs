/** One-off probe: expand the remote group and dump row texts (arrows included). */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3080'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
await chip.click()
await page.waitForTimeout(700)
// Expand the remote group header (its label reads 远程分支/Remote branches).
const remoteHeader = page.locator('button[aria-expanded]').filter({ hasText: /(远程分支|Remote branches)/ }).first()
console.log('remote header found:', await remoteHeader.count())
if (await remoteHeader.count() > 0) {
  await remoteHeader.click()
  await page.waitForTimeout(400)
  // The remote rows live inside folder headers that start collapsed past
  // TREE_MIN_ROWS — expand everything via the toolbar's expand-all tool
  // (chevron button, the toolbar's last child).
  const expandAll = page.locator('div[role="menu"] div[role="toolbar"] button').last()
  await expandAll.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'scripts/probe-remote-open.png' })
  const rows = await page.evaluate(() => {
    return [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')]
      .map(b => ({ branch: b.dataset.branch, text: (b.textContent ?? '').trim(), disabled: b.disabled }))
  })
  console.log(JSON.stringify(rows, null, 1))
  // Double-click a remote row (a name the local set does not have) to pop
  // its three-line confirm flyout.
  const localNames = new Set(['backup/main-before-split', 'feat/dsh-0.1.2-alpha.1', 'main', 'main-wt',
    'feature/ccsa-sync', 'feature/chip-request-refresh', 'feature/plan-usage', 'feature/startup-wait-settings',
    'feature/sync-miss-token', 'feature/sync-miss-token-bak', 'feature/usage-tab-v1',
    'feature/适配工作日峰谷定价'])
  const remoteRow = rows.find(r => !r.disabled && r.branch !== undefined && !localNames.has(r.branch))
  if (remoteRow !== undefined) {
    await page.locator(`div[role="menu"] button[data-branch="${remoteRow.branch.replace(/["\\]/g, '\\$&')}"]`).dblclick()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'scripts/probe-remote-confirm.png' })
    const fly = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '')
    console.log('flyout:', JSON.stringify(fly))
    const rects = await page.evaluate(() => {
      const r = el => {
        if (el === null) return null
        const b = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return { left: b.left, top: b.top, w: b.width, h: b.height, styleLeft: s.left, styleTop: s.top }
      }
      const row = [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')]
        .find(b => b.getAttribute('aria-selected') === 'true' || b.className.includes('Picked'))
      return {
        dialog: r(document.querySelector('[role="dialog"]')),
        card: r(document.querySelector('div[role="menu"]')),
        pickedRow: r(row),
        vw: innerWidth, vh: innerHeight,
        scrollY: scrollY,
      }
    })
    console.log('rects:', JSON.stringify(rects))
  }
}
await browser.close()
