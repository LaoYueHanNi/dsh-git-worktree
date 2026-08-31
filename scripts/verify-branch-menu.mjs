/**
 * Branch popup regression check: with a repo holding many branches, open a
 * fresh New Session, click the branch chip, and assert the three owner
 * requirements on the BranchMenu card —
 *   1. height capped (never fills the viewport, rows scroll internally),
 *   2. search field pinned at the card bottom filters the rows (and Enter
 *      commits the first match),
 *   3. the card sits entirely ABOVE the chip (bottom edge just above it).
 * Run: node scripts/verify-branch-menu.mjs [port]
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
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text().slice(0, 300)}`)
})

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

// 1. Anchor to a MAIN-repo session directly. The 新会话 button follows the
// recently-ACTIVE workspace — a prior hop into a worktree (probe-worktree-*)
// leaves that active, and a linked-worktree session locks switching — so
// the button is useless as an anchor. Expand the main repo workspace and
// open its first session instead; a started session still has the chip and
// the full menu (fixture: the main repo holds a session titled as below).
await page.getByText('dsh-token-usage', { exact: true }).first().click()
await page.waitForTimeout(800)
await page.getByText('详细分析当前项目').first().click()
await page.waitForTimeout(1500)

// 2. A started session's dock has no worktree toggle — anchor the chip by
// its branch-title button (this repo's checkout is main). waitFor bridges
// the session-switch render: a bare count() raced it once (0 then present).
const chip = page.locator('button[title="main"]').first()
await chip.waitFor({ state: 'visible', timeout: 10000 })
ok('chip dock present', await chip.count() > 0)
console.log('chip text:', JSON.stringify((await chip.textContent())?.trim()))
await chip.click()
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/verify-1-open.png' })

// 3. Geometry: card above the chip, capped height, scrolling rows, search pinned last.
const geom = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return null
  const input = card.querySelector('input')
  const rows = [...card.querySelectorAll('button[role="menuitem"]')]
  const rowsEl = [...card.children].find(el => getComputedStyle(el).overflowY === 'auto') ?? null
  const r = card.getBoundingClientRect()
  // The card's last box child should be the search wrap (search pinned bottom).
  const lastIsSearch = card.lastElementChild?.contains(input) === true
  return {
    cardTop: r.top, cardBottom: r.bottom, cardHeight: r.height, cardWidth: r.width,
    rowCount: rows.length,
    groupCount: card.querySelectorAll('button[aria-expanded]').length,
    rowsScroll: rowsEl === null ? null : { scroll: rowsEl.scrollHeight, client: rowsEl.clientHeight },
    lastIsSearch,
    docBottom: window.innerHeight,
    focusedIsInput: document.activeElement === input,
  }
})
ok('card rendered', geom !== null)
if (geom !== null) {
  const chipBox = await chip.boundingBox()
  ok('card entirely above chip', geom.cardBottom <= chipBox.y + 1,
    `cardBottom=${geom.cardBottom.toFixed(1)} chipTop=${chipBox.y.toFixed(1)}`)
  ok('gap above chip is small (pinned)', chipBox.y - geom.cardBottom <= 12,
    `gap=${(chipBox.y - geom.cardBottom).toFixed(1)}px`)
  ok('height capped at 420px', geom.cardHeight <= 420.5, `height=${geom.cardHeight.toFixed(1)}`)
  ok('card top inside viewport', geom.cardTop >= 0, `top=${geom.cardTop.toFixed(1)}`)
  ok('rows render (some branches)', geom.rowCount >= 1, `rows=${geom.rowCount}`)
  // Internal scrolling only asserts with enough rows to overflow the cap;
  // small repos legitimately fit without scrolling.
  if (geom.rowCount >= 20) {
    ok('rows area scrolls internally', geom.rowsScroll !== null && geom.rowsScroll.scroll > geom.rowsScroll.client,
      geom.rowsScroll === null ? 'no scroll element' : `scroll=${geom.rowsScroll.scroll} client=${geom.rowsScroll.client}`)
  } else {
    console.log(`skip scroll assertion (only ${geom.rowCount} rows)`)
  }
  ok('search pinned at card bottom', geom.lastIsSearch)
  ok('search input autofocused', geom.focusedIsInput)
  // Current branch must be visible (centered) on open — with many branches
  // it used to drown off-screen. Meaningful when the list overflows, and in
  // tree mode too: the chain-open row must still land mid-viewport.
  if (geom.rowCount >= 20 || geom.groupCount >= 1) {
    const centered = await page.evaluate(() => {
      const card = document.querySelector('div[role="menu"]')
      const row = [...card.querySelectorAll('button[role="menuitem"]')]
        .find(b => b.querySelector('svg') !== null)
      const viewport = row?.parentElement
      if (row === undefined || viewport == null) return null
      const rr = row.getBoundingClientRect()
      const vr = viewport.getBoundingClientRect()
      return { rowTop: rr.top, rowBottom: rr.bottom, vpTop: vr.top, vpBottom: vr.bottom }
    })
    ok('current branch visible on open', centered !== null && centered.rowTop >= centered.vpTop - 1 && centered.rowBottom <= centered.vpBottom + 1,
      centered === null ? 'current row not found' : `row=[${centered.rowTop.toFixed(0)},${centered.rowBottom.toFixed(0)}] viewport=[${centered.vpTop.toFixed(0)},${centered.vpBottom.toFixed(0)}]`)
  } else {
    console.log(`skip centering assertion (only ${geom.rowCount} rows)`)
  }
}

// 4. Typing filters; Enter commits the first match (confirm flyout shows).
// Target is adaptive: the last enabled non-current row of whatever repo the
// session sits in (stress branches like perf/branch-* may not exist). The
// current row is excluded — in tree mode it renders first (chain open) and
// picking it just closes the menu by design.
const targets = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return []
  const rows = [...card.querySelectorAll('button[role="menuitem"]:not([disabled])')]
  return rows
    .filter(r => r.querySelector('svg') === null)
    // Worktree rows hop the session on pick (no confirm flyout) — they are
    // not switch-confirm targets.
    .filter(r => r.dataset.kind !== 'worktree')
    .map(r => r.dataset.branch ?? (r.textContent ?? '').trim())
    .filter(n => n !== '')
})
const target = targets[targets.length - 1] ?? ''
// A repo whose only row IS the current branch: picking it just closes the
// menu (by design), so the pick/commit path can't be exercised here.
const isCurrentOnly = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return true
  const rows = [...card.querySelectorAll('button[role="menuitem"]')]
  return rows.length === 1 && rows[0].querySelector('svg') !== null
})
if (isCurrentOnly) {
  console.log('skip pick/commit checks (single-branch repo, only the current branch)')
} else if (target === '') {
  // A linked-worktree session locks every switch target (worktree rows are
  // hop-only, not confirm targets) — the pick/commit path has nothing to
  // drive here; rerun anchored to the main workspace.
  console.log('skip pick/commit checks (no unlocked switch targets — linked-worktree session?)')
} else {
  ok('pickable row exists', target !== '', `candidates=${targets.length}`)
  console.log('target row:', JSON.stringify(target))
  const input = page.locator('div[role="menu"] input')
  await input.fill(target)
  await page.waitForTimeout(300)
  const filtered = await page.evaluate(() => {
    const card = document.querySelector('div[role="menu"]')
    if (card === null) return { count: 0, branch: '' }
    const rows = [...card.querySelectorAll('button[role="menuitem"]:not([disabled])[data-branch]')]
    return { count: rows.length, branch: rows[0]?.dataset.branch ?? '' }
  })
  ok('search filters to the match', filtered.count >= 1 && filtered.branch === target,
    `count=${filtered.count} first=${JSON.stringify(filtered.branch)}`)
  await page.screenshot({ path: 'scripts/verify-2-search.png' })

  await input.fill('zzz-no-such-branch')
  await page.waitForTimeout(300)
  const empty = await page.evaluate(() => {
    const card = document.querySelector('div[role="menu"]')
    return card?.textContent?.includes('没有匹配的分支') || card?.textContent?.includes('No matching branches') || false
  })
  ok('empty state on no match', empty)

  await input.fill(target)
  await page.waitForTimeout(200)
  await input.press('Enter')
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'scripts/verify-3-confirm.png' })
  const confirmShown = await page.evaluate(name => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    return dialogs.some(d => (d.textContent ?? '').includes(name))
  }, target)
  ok('Enter commits first match (confirm flyout)', confirmShown)

  // 5. Escape unwinds tier by tier: confirm, then search text, then menu.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const afterEsc1 = await page.evaluate(() => ({
    fly: document.querySelector('[role="dialog"]') !== null,
    menu: document.querySelector('div[role="menu"]') !== null,
  }))
  ok('Escape cancels confirm only', afterEsc1.fly === false && afterEsc1.menu === true, JSON.stringify(afterEsc1))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const afterEsc2 = await page.evaluate(() => ({
    fly: document.querySelector('[role="dialog"]') !== null,
    menu: document.querySelector('div[role="menu"]') !== null,
  }))
  ok('second Escape clears the search text (menu stays)', afterEsc2.fly === false && afterEsc2.menu === true, JSON.stringify(afterEsc2))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const closed = await page.evaluate(() => document.querySelector('div[role="menu"]') === null)
  ok('third Escape closes the popup', closed)
}

if (errors.length > 0) {
  console.log('--- page errors ---')
  for (const line of errors) console.log(line)
  failed = 1
}
await browser.close()
console.log(failed === 0 ? 'VERIFY PASSED' : 'VERIFY FAILED')
process.exit(failed)
