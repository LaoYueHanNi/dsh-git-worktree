/** One-off probe for the review-fix batch: exercises the four UI fixes on a
 * real repo (dsh-token-usage, fixture session「详细分析当前项目」) with a
 * throwaway worktree (`probe/wt-checkout`, created by the caller):
 *   fix1 — the create-branch (plus) tool UNMOUNTS instead of disabling when
 *          `canCreate` is false: absent in worktree mode (toggle armed) and
 *          absent in a blank linked-worktree session; present and enabled in
 *          a blank main-checkout session. Toolbar neighbors stay.
 *   fix2 — search-view group header counts MATCHES (search 'feature' → (7),
 *          not the full (8)/(9)); worktree group counts its filtered rows.
 *   fix3 — locate-current opens the WORKTREE group when the current branch's
 *          row lives there (blank linked-worktree session, group collapsed
 *          by hand), and the row lands inside the scrolling viewport.
 * Run: node scripts/probe-review-fixes.mjs [port]   (cleanup: caller)
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3080'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
let failed = 0
const ok = (label, condition, detail = '') => {
  console.log(`${condition ? 'ok' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failed = 1
}
page.on('pageerror', err => errors.push(`[pageerror] ${err.message.slice(0, 300)}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`[console.error] ${msg.text().slice(0, 300)}`) })

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

/** Toolbar-button lookup by title substrings (locale-proof). */
const tool = (subs) => page.evaluate((subs) => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return null
  const btn = [...card.querySelectorAll('[role="toolbar"] button')]
    .find(b => subs.some(s => b.title.includes(s)))
  return btn === undefined ? null : { title: btn.title, disabled: btn.disabled }
}, subs)
const plusSubs = ['新建分支', 'Create branch']
const locateSubs = ['定位', 'Locate']
const esc = () => page.keyboard.press('Escape')

/** Top-level group-header reader: the header is a BUTTON when collapsible
 * (normal view) but a DIV in the search view (renderGroupHeader renders
 * inert there) — match by the shared menuGroupTop class, not by tag. */
const groupHeaders = () => page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return []
  return [...card.querySelectorAll('[class*="menuGroupTop"]')]
    .map(b => ({
      text: (b.querySelector('[class*="menuGroupLabel"]')?.textContent ?? '').trim(),
      count: b.querySelector('[class*="menuGroupCount"]')?.textContent ?? '',
    }))
})

// A. Anchor the MAIN-repo workspace (fixture session), then a blank session.
await page.getByText('dsh-token-usage', { exact: true }).first().click()
await page.waitForTimeout(800)
await page.getByText('详细分析当前项目').first().click()
await page.waitForTimeout(1500)
await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)
const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const mainChip = toggle.locator('xpath=preceding-sibling::button[1]')

// B1. fix1 (control): blank MAIN-checkout session keeps the plus, enabled.
await mainChip.click()
await page.waitForTimeout(700)
const plusMain = await tool(plusSubs)
ok('fix1 plus present+enabled in blank main session', plusMain !== null && !plusMain.disabled, JSON.stringify(plusMain))
await page.screenshot({ path: 'scripts/probe-fix-1a-plus-main.png' })

// B2. fix2: search 'feature' — local header must count MATCHES (7 of 8).
await page.locator('div[role="menu"] input').fill('feature')
await page.waitForTimeout(300)
const search = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  const rows = [...card.querySelectorAll('button[role="menuitem"]:not([disabled])')]
  return { rows: rows.length }
})
const searchHeaders = await groupHeaders()
const localHeader = searchHeaders.find(h => h.text.includes('本地分支') || h.text.includes('Local branches'))
// (7) in the header — the MATCH count, not the full 9. Rows render 9: the
// search view ignores group toggles, and the 2 remote rows (ccsa-sync,
// sync-miss-token — the only twins-less remotes) match 'feature' too.
ok('fix2 local header counts matches', localHeader !== undefined && localHeader.count === '(7)' && search.rows === 9,
  `header=${JSON.stringify(localHeader)} rows=${search.rows}`)
await page.screenshot({ path: 'scripts/probe-fix-2-search-count.png' })
await page.locator('div[role="menu"] input').fill('')
await page.waitForTimeout(300)

// B3. fix1 (worktree mode): arming the toggle unmounts the plus, neighbors stay.
await esc()
await page.waitForTimeout(300)
await toggle.click()
await page.waitForTimeout(800)
await mainChip.click()
await page.waitForTimeout(700)
const plusMode = await tool(plusSubs)
const locateMode = await tool(locateSubs)
ok('fix1 plus UNMOUNTED in worktree mode', plusMode === null, JSON.stringify(plusMode))
ok('fix1 toolbar neighbors stay in worktree mode', locateMode !== null, JSON.stringify(locateMode))
await page.screenshot({ path: 'scripts/probe-fix-1b-plus-worktree-mode.png' })
await esc()
await page.waitForTimeout(300)
await toggle.click() // disarm — leave the session as found
await page.waitForTimeout(500)

// C. fix2/worktree-group prep + hop: the probe branch lives in the worktree
// group (moved out of local — header count (8) proves the move), double-click hops.
await mainChip.click()
await page.waitForTimeout(700)
const groupList = await groupHeaders()
const groups = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  const wtRow = [...card.querySelectorAll('button[role="menuitem"]')].find(b => b.dataset.kind === 'worktree')
  return { wtBranch: wtRow?.dataset.branch ?? null }
})
const localFull = groupList.find(h => h.text.includes('本地分支') || h.text.includes('Local branches'))
// 10 local branches exist since `worktree add -b` created probe/wt-checkout;
// the held one leaves the local group → (9). The worktree group holds the row.
ok('held branch left the local group (9 rows)', localFull?.count === '(9)', JSON.stringify(localFull))
ok('probe worktree row present', groups.wtBranch === 'probe/wt-checkout', JSON.stringify(groups.wtBranch))
if (groups.wtBranch === null) {
  console.log('no worktree row — abort before hop')
  await browser.close()
  process.exit(failed === 0 ? 2 : 1)
}
await page.locator(`div[role="menu"] button[data-branch="${groups.wtBranch.replace(/["\\]/g, '\\$&')}"]`).dblclick()
await page.waitForTimeout(2500)

// D. Blank linked-worktree session: fix1 (plus gone) + fix3 (locate opens
// the worktree group and lands the current-branch row in view).
const wtChip = page.locator('button[title="probe/wt-checkout"]').first()
ok('hopped into the worktree session', await wtChip.count() > 0)
await wtChip.click()
await page.waitForTimeout(700)
const plusWt = await tool(plusSubs)
ok('fix1 plus UNMOUNTED in blank worktree session', plusWt === null, JSON.stringify(plusWt))
await page.screenshot({ path: 'scripts/probe-fix-1c-plus-wt-session.png' })

// fix3: collapse the worktree group by hand, then locate.
const wtGroupSel = 'div[role="menu"] button[aria-expanded]'
const groupState = () => page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  const header = [...card.querySelectorAll('button[aria-expanded]')]
    .find(b => ['工作树', 'Worktrees'].some(s => (b.querySelector('[class*="menuGroupLabel"]')?.textContent ?? '').trim() === s))
  if (header === undefined) return null
  // A collapsed group unmounts its rows BY DESIGN — row presence is part
  // of the answer, not a lookup failure.
  const row = [...card.querySelectorAll('button[role="menuitem"]')].find(b => b.dataset.branch === 'probe/wt-checkout')
  if (row === undefined) return { expanded: header.getAttribute('aria-expanded'), rowRendered: false, inView: false }
  const viewport = row.parentElement
  const rr = row.getBoundingClientRect()
  const vr = viewport.getBoundingClientRect()
  return { expanded: header.getAttribute('aria-expanded'), rowRendered: true, inView: rr.top >= vr.top - 1 && rr.bottom <= vr.bottom + 1 }
})
await page.locator(wtGroupSel).filter({ hasText: '工作树' }).or(page.locator(wtGroupSel).filter({ hasText: 'Worktrees' })).first().click()
await page.waitForTimeout(300)
const collapsed = await groupState()
ok('fix3 worktree group collapsed by hand', collapsed !== null && collapsed.expanded === 'false' && collapsed.rowRendered === false, JSON.stringify(collapsed))
await page.locator('[role="toolbar"] button').evaluateAll((btns, subs) => {
  const btn = btns.find(b => subs.some(s => b.title.includes(s)))
  btn?.click()
}, locateSubs)
await page.waitForTimeout(500)
const located = await groupState()
ok('fix3 locate reopens the worktree group', located !== null && located.expanded === 'true' && located.rowRendered === true, JSON.stringify(located))
ok('fix3 current row inside the scrolling viewport', located !== null && located.inView, JSON.stringify(located))
await page.screenshot({ path: 'scripts/probe-fix-3-locate-worktree-group.png' })

// fix2 (worktree group): search 'probe' — header (1), no local header.
await page.locator('div[role="menu"] input').fill('probe')
await page.waitForTimeout(300)
const search2Rows = await page.evaluate(() =>
  document.querySelectorAll('div[role="menu"] button[role="menuitem"]').length)
const search2Headers = await groupHeaders()
const wtHeader = search2Headers.find(h => h.text.includes('工作树') || h.text.includes('Worktrees'))
const localHeader2 = search2Headers.find(h => h.text.includes('本地分支') || h.text.includes('Local branches'))
ok('fix2 worktree header counts its match, local header absent', wtHeader?.count === '(1)' && localHeader2 === undefined && search2Rows === 1,
  `wt=${JSON.stringify(wtHeader)} local=${JSON.stringify(localHeader2)} rows=${search2Rows}`)

// E. Restore: reactivate the fixture main-repo session.
await esc()
await page.waitForTimeout(300)
await page.getByText('详细分析当前项目').first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: 'scripts/probe-fix-restored.png' })

if (errors.length > 0) {
  console.log('--- page errors ---')
  for (const line of errors) console.log(line)
  failed = 1
}
await browser.close()
console.log(failed === 0 ? 'PROBE PASSED' : 'PROBE FAILED')
process.exit(failed)
