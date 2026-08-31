/** One-off probe: the scoped menu of a blank linked-worktree session —
 * every row stays readable (no disabled), any pick answers with the
 * main-checkout toast (worktree hops included), and the session does not
 * move. */
import { chromium } from 'playwright-core'

const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
// Anchor a main-repo session first (the hop below needs a main-checkout
// blank session with the worktree group).
await page.getByText('dsh-token-usage', { exact: true }).first().click()
await page.waitForTimeout(800)
await page.getByText('详细分析当前项目').first().click()
await page.waitForTimeout(1500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const mainChip = toggle.locator('xpath=preceding-sibling::button[1]')
console.log('chip at start:', JSON.stringify((await mainChip.textContent())?.trim()))
await mainChip.click()
await page.waitForTimeout(700)
// 1. A blank MAIN-checkout session still hops: double-click a worktree row.
const wtRow = await page.evaluate(() => {
  const row = [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')]
    .find(b => b.dataset.kind === 'worktree')
  return row?.dataset.branch ?? null
})
if (wtRow === null) {
  console.log('no worktree row — abort')
  await browser.close()
  process.exit(1)
}
await page.locator(`div[role="menu"] button[data-branch="${wtRow.replace(/["\\]/g, '\\$&')}"]`).dblclick()
await page.waitForTimeout(2500)
// Inside the worktree session the worktree toggle is GONE (scoped entry) —
// anchor the chip by its branch title instead.
console.log('chip after main-checkout hop:', JSON.stringify((await page.locator(`button[title="${wtRow.replace(/["\\]/g, '\\$&')}"]`).first().textContent())?.trim()))
const chip = page.locator(`button[title="${wtRow.replace(/["\\]/g, '\\$&')}"]`).first()
// Re-open the menu inside the BLANK linked-worktree session.
await chip.click()
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/probe-worktree-scope.png' })
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')]
    .map(b => ({
      branch: b.dataset.branch,
      kind: b.dataset.kind,
      disabled: b.disabled,
      // Locked rows dim via a style class — clickable on purpose.
      locked: String(b.className).includes('Locked'),
      title: b.title === '' ? undefined : b.title.slice(0, 16),
    })),
)
const lockedCount = rows.filter(r => r.locked).length
const disabledCount = rows.filter(r => r.disabled).length
console.log(`rows=${rows.length} locked=${lockedCount} disabled=${disabledCount} (expect locked>0, disabled=0 — dim without swallowing clicks)`)
// 3. Double-click a LOCAL row: the toast must appear, the session must not move.
const localRow = rows.find(r => r.kind === 'local')
if (localRow !== undefined) {
  await page.locator(`div[role="menu"] button[data-branch="${localRow.branch.replace(/["\\]/g, '\\$&')}"]`).dblclick()
  await page.waitForTimeout(600)
  const toast = await page.evaluate(() => document.body.textContent?.includes('分支操作请在主仓库发起') ?? false)
  const chipNow = JSON.stringify((await chip.textContent())?.trim())
  console.log('local pick toast shown:', toast, '| chip still:', chipNow)
  // 4. Double-click a WORKTREE row: same hint, still no hop.
  const wt = rows.find(r => r.kind === 'worktree')
  if (wt !== undefined) {
    await page.locator(`div[role="menu"] button[data-branch="${wt.branch.replace(/["\\]/g, '\\$&')}"]`).dblclick()
    await page.waitForTimeout(600)
    const toast2 = await page.evaluate(() => document.body.textContent?.includes('分支操作请在主仓库发起') ?? false)
    console.log('worktree pick toast shown:', toast2, '| chip still:', JSON.stringify((await chip.textContent())?.trim()))
  }
}
await page.screenshot({ path: 'scripts/probe-worktree-scope-2.png' })
await browser.close()
