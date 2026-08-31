/** One-off probe: the worktree group renders on a blank session and a
 * double-click hops the session into that worktree directory. */
import { chromium } from 'playwright-core'

const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
console.log('chip before:', JSON.stringify((await chip.textContent())?.trim()))
await chip.click()
await page.waitForTimeout(700)
const headers = await page.evaluate(() =>
  [...document.querySelectorAll('div[role="menu"] button[aria-expanded]')]
    .slice(0, 2)
    .map(b => (b.textContent ?? '').trim())
    .concat([...document.querySelectorAll('div[role="menu"] div[role="presentation"].menuGroup, div[role="menu"] button')]
      .map(b => (b.textContent ?? '').trim())
      .filter(t => t.startsWith('工作树') || t.startsWith('Worktrees'))),
)
console.log('group headers seen:', JSON.stringify(headers))
const wtRow = await page.evaluate(() => {
  const row = [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')]
    .find(b => b.dataset.kind === 'worktree')
  return row === undefined ? null : { branch: row.dataset.branch, title: row.title, disabled: row.disabled }
})
console.log('worktree row:', JSON.stringify(wtRow))
if (wtRow !== null) {
  await page.screenshot({ path: 'scripts/probe-worktree-group.png' })
  await page.locator(`div[role="menu"] button[data-branch="${wtRow.branch.replace(/["\\]/g, '\\$&')}"]`).dblclick()
  await page.waitForTimeout(2500)
  const toggle2 = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
  const chip2 = toggle2.locator('xpath=preceding-sibling::button[1]')
  console.log('chip after hop:', JSON.stringify((await chip2.textContent())?.trim()))
  await page.screenshot({ path: 'scripts/probe-worktree-hopped.png' })
}
await browser.close()
