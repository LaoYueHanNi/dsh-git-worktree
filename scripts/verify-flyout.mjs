/**
 * Confirm-flyout regression: covers the five owner requirements —
 *   1. search input font weight unified with the chip (500);
 *   2. heading row stays secondary-weight (400);
 *   3. flyout width follows the branch name (content-driven, capped);
 *   4. picking another row while the flyout is open RE-ANCHORS it (it used
 *      to stay at the first row and just re-render the text);
 *   5. flyout never overlaps the branch list (anchored right of the card)
 *      and is vertically centered on the picked row.
 * Plus the tiered-Escape / outside-click / Enter-commit paths.
 * Run: node scripts/verify-flyout.mjs [port]
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3080'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
let failed = 0
const ok = (label, condition, detail = '') => {
  console.log(`${condition ? 'ok' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failed = 1
}

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

let chip = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first().locator('xpath=preceding-sibling::button[1]')
if (await chip.count() === 0) {
  chip = page.locator('button').filter({ hasText: /^(main$|[\w.-]+\/[\w./-]+)/ }).first()
}
ok('chip found', await chip.count() > 0)
await chip.click()
await page.waitForTimeout(600)

const menu = page.locator('div[role="menu"]')
ok('menu open', await menu.count() > 0)

// ── Req 1 & 2: typography ─────────────────────────────────────────────
const fonts = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  const w = el => (el === null || el === undefined ? null : getComputedStyle(el).fontWeight)
  return {
    row: w(card?.querySelector('button[role="menuitem"]')),
    search: w(card?.querySelector('input')),
    heading: w(card?.firstElementChild), // the heading is the card's first child
  }
})
ok('row weight 500 (chip-matched)', fonts.row === '500', fonts.row ?? '')
ok('search weight 500 (req 1)', fonts.search === '500', fonts.search ?? '')
ok('heading weight 400 (req 2, untouched)', fonts.heading === '400', fonts.heading ?? '')

// ── Row pick helper: search the full name, select + Enter to stage the
// confirm flyout (IDEA model: a click selects, Enter checks out) ───────
const pickRow = async (name) => {
  await menu.locator('input').fill(name)
  await page.waitForTimeout(300)
  const row = menu.locator(`button[data-branch="${CSS.escape(name)}"]`)
  if (await row.count() === 0) return { ok: false, seen: 'no matching row' }
  await row.click()
  await page.waitForTimeout(150)
  await row.press('Enter')
  await page.waitForTimeout(600)
  return { ok: true }
}

// Pick the primary target: the last distinct NON-CURRENT row of whatever
// repo the session sits in (adaptive — stress branches may not exist).
// The current row is excluded: it renders first in tree mode (its chain
// opens by default) and picking it closes the menu by design.
const rowsInfo = await menu.locator('button[role="menuitem"]')
  .evaluateAll(nodes => nodes.map(n => ({
    name: n.dataset.branch ?? (n.textContent ?? '').trim(),
    current: n.querySelector('svg') !== null,
  })))
const names = rowsInfo.filter(r => !r.current).map(r => r.name)
  .filter((n, i, a) => a.indexOf(n) === i)
const targetA = names[names.length - 1] ?? ''
console.log(`target: A=${JSON.stringify(targetA)}`)

// A repo whose only row IS the current branch: picking it just closes the
// menu (by design) — every pick-dependent check below is unexercisable.
const currentOnly = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return true
  const rows = [...card.querySelectorAll('button[role="menuitem"]')]
  return rows.length === 1 && rows[0].querySelector('svg') !== null
})

const pickA = currentOnly ? { ok: false, skipped: true } : await pickRow(targetA)
if (currentOnly) {
  // Single-branch repo: close cleanly and stop — every remaining check
  // needs a pickable non-current row.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await browser.close()
  console.log('FLYOUT VERIFY PASSED (pick-dependent checks skipped — repo has only the current branch)')
  process.exit(failed)
}
ok('pick row A', pickA.ok, pickA.ok ? '' : JSON.stringify(pickA))
const rectA = await page.evaluate(() => {
  const fly = document.querySelector('[role="dialog"]')
  const card = document.querySelector('div[role="menu"]')
  if (fly === null || card === null) return null
  const f = fly.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  return { flyLeft: f.left, flyTop: f.top, flyW: f.width, flyH: f.height, cardRight: c.right, vw: window.innerWidth }
})
ok('flyout rendered for A', rectA !== null)
if (rectA !== null) {
  ok('no list overlap (right of card)', rectA.flyLeft >= rectA.cardRight - 0.5,
    `flyLeft=${rectA.flyLeft.toFixed(1)} cardRight=${rectA.cardRight.toFixed(1)}`)
  ok('inside viewport x', rectA.flyLeft >= 0 && rectA.flyLeft + rectA.flyW <= rectA.vw + 0.5,
    `left=${rectA.flyLeft.toFixed(1)} w=${rectA.flyW.toFixed(1)} vw=${rectA.vw}`)
}

// Vertical centering on the picked row (req 5).
const centered = await page.evaluate(name => {
  const card = document.querySelector('div[role="menu"]')
  const fly = document.querySelector('[role="dialog"]')
  if (card === null || fly === null) return null
  const row = [...card.querySelectorAll('button[role="menuitem"][data-branch]')].find(b => b.dataset.branch === name)
  if (row === undefined) return null
  const f = fly.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  return { flyCenter: f.top + f.height / 2, rowCenter: r.top + r.height / 2 }
}, targetA)
ok('flyout vertically centered on row', centered !== null && Math.abs(centered.flyCenter - centered.rowCenter) <= 2,
  centered === null ? 'row not found' : `Δ=${(centered.flyCenter - centered.rowCenter).toFixed(2)}px`)

// ── Req 4: re-pick while open → flyout moves to the new row ───────────
// Restore the full list (the searches above narrowed it to one row, which
// would render both targets at the same spot), then click ANOTHER enabled
// row — the flyout must follow it. Needs a second pickable row; small
// repos (single branch besides the current) can't exercise re-anchoring.
await menu.locator('input').fill('')
await page.waitForTimeout(300)
const pickables = (await menu.locator('button[role="menuitem"]:not([disabled])')
  .evaluateAll(nodes => nodes.map(n => ({
    name: n.dataset.branch ?? (n.textContent ?? '').trim(),
    current: n.querySelector('svg') !== null,
  }))))
  .filter(r => !r.current)
  .map(r => r.name)
  .filter(n => n !== targetA)
let rectB = null
let otherName = ''
if (pickables.length > 0) {
  // The confirm flyout is open here, so a click re-picks (re-anchors) —
  // no Enter needed: the click handler stages the pick while a confirm is
  // showing (the old one-click flow), per the menu's interaction model.
  const otherRow = menu.locator(`button[data-branch="${CSS.escape(pickables[0])}"]`)
  otherName = pickables[0]
  await otherRow.scrollIntoViewIfNeeded()
  await otherRow.click()
  await page.waitForTimeout(600)
  rectB = await page.evaluate(() => {
    const fly = document.querySelector('[role="dialog"]')
    const card = document.querySelector('div[role="menu"]')
    if (fly === null || card === null) return null
    const f = fly.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    return { flyLeft: f.left, flyTop: f.top, flyW: f.width, cardRight: c.right }
  })
  ok('flyout re-anchored (top moved)', rectA !== null && rectB !== null && Math.abs(rectB.flyTop - rectA.flyTop) > 1,
    rectA && rectB ? `topA=${rectA.flyTop.toFixed(1)} topB=${rectB.flyTop.toFixed(1)} (row: ${otherName})` : '')
} else {
  console.log('skip re-anchor checks (single pickable row in this repo)')
}
if (rectB !== null) {
  ok('re-anchored still right of card', rectB.flyLeft >= rectB.cardRight - 0.5,
    `flyLeft=${rectB.flyLeft.toFixed(1)} cardRight=${rectB.cardRight.toFixed(1)}`)
  const centeredB = await page.evaluate(name => {
    const card = document.querySelector('div[role="menu"]')
    const fly = document.querySelector('[role="dialog"]')
    const row = [...card.querySelectorAll('button[role="menuitem"][data-branch]')].find(b => b.dataset.branch === name)
    if (fly === null || row === undefined) return null
    const f = fly.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return { flyCenter: f.top + f.height / 2, rowCenter: r.top + r.height / 2 }
  }, otherName)
  ok('re-anchored vertically centered', centeredB !== null && Math.abs(centeredB.flyCenter - centeredB.rowCenter) <= 2,
    centeredB === null ? 'row not found' : `Δ=${(centeredB.flyCenter - centeredB.rowCenter).toFixed(2)}px`)
}

// ── Req 3: width follows the branch name ──────────────────────────────
if (rectA !== null) {
  ok('width within cap', rectA.flyW <= 400.5, `wA=${rectA.flyW.toFixed(1)}`)
}
if (rectA !== null && rectB !== null && otherName !== targetA) {
  const widthsDiffer = Math.abs(rectA.flyW - rectB.flyW) > 0.5
  ok('width content-driven (differs per name)', widthsDiffer,
    `wA=${rectA.flyW.toFixed(1)} wB=${rectB.flyW.toFixed(1)} (A=${targetA} B=${otherName})`)
}

// ── Escape tier 1: confirm closes, menu stays ─────────────────────────
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const afterEsc1 = await page.evaluate(() => ({
  fly: document.querySelector('[role="dialog"]') !== null,
  menu: document.querySelector('div[role="menu"]') !== null,
}))
ok('Escape cancels confirm only', afterEsc1.fly === false && afterEsc1.menu === true, JSON.stringify(afterEsc1))

// ── Enter-commit path: search + Enter opens a VISIBLE flyout ──────────
await menu.locator('input').fill(targetA.slice(-12))
await page.waitForTimeout(250)
await menu.locator('input').press('Enter')
await page.waitForTimeout(600)
const enterFly = await page.evaluate(() => {
  const fly = document.querySelector('[role="dialog"]')
  if (fly === null) return null
  const r = fly.getBoundingClientRect()
  return { left: r.left, top: r.top }
})
ok('Enter-commit shows visible flyout', enterFly !== null && enterFly.left > 0,
  enterFly === null ? 'no flyout' : `left=${enterFly.left.toFixed(1)}`)

// ── Outside click: both close ─────────────────────────────────────────
await page.mouse.click(30, 30)
await page.waitForTimeout(300)
const afterOutside = await page.evaluate(() => ({
  fly: document.querySelector('[role="dialog"]') !== null,
  menu: document.querySelector('div[role="menu"]') !== null,
}))
ok('outside click closes both', afterOutside.fly === false && afterOutside.menu === false, JSON.stringify(afterOutside))

await browser.close()
console.log(failed === 0 ? 'FLYOUT VERIFY PASSED' : 'FLYOUT VERIFY FAILED')
process.exit(failed)
