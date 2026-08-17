/**
 * Non-invasive geometry probe for the branch popup: find the branch chip in
 * the CURRENT view (no new session created), open the popup, focus the
 * search field, and dump precise measurements to diagnose the reported
 * right-side clipping (missing rounded corner on the right).
 * Run: node scripts/inspect-menu.mjs [port]
 */
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '3080'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

// Find the chip without creating a session: the button preceding the
// 工作树/Worktree toggle, else any small button starting with a branch-ish
// label. Try the toggle path first (blank session), fall back to scanning.
let chip = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
  .locator('xpath=preceding-sibling::button[1]')
if (await chip.count() === 0) {
  // Started sessions: dock has a lone chip button. Heuristic: a button whose
  // text matches a branch-like name (contains '/' or starts with 'main'/'dev').
  chip = page.locator('button').filter({ hasText: /^(main$|[\w.-]+\/[\w./-]+)/ }).first()
}
if (await chip.count() === 0) {
  console.log('PROBE: no branch chip found in current view')
  await browser.close()
  process.exit(2)
}
console.log('chip text:', JSON.stringify((await chip.textContent())?.trim()))
await chip.click()
await page.waitForTimeout(600)

// Click into the search field to reproduce the reported focus state.
const input = page.locator('div[role="menu"] input')
if (await input.count() > 0) await input.click()
await page.waitForTimeout(300)
await page.screenshot({ path: 'scripts/inspect-1-open.png', fullPage: false })

const data = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  if (card === null) return null
  const input = card.querySelector('input')
  const wrap = input?.closest('div') ?? null
  const rows = [...card.children].find(el => getComputedStyle(el).overflowY === 'auto') ?? null
  const cs = getComputedStyle(card)
  const r = card.getBoundingClientRect()
  const ir = input?.getBoundingClientRect()
  const wr = wrap?.getBoundingClientRect()
  const cb = document.documentElement.clientWidth
  return {
    viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, clientWidth: cb },
    card: {
      left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
      boxSizing: cs.boxSizing, boxShadow: cs.boxShadow, overflow: cs.overflow, radius: cs.borderRadius,
      rightMarginToViewport: window.innerWidth - r.right,
    },
    searchWrap: wr && { left: wr.left, right: wr.right, width: wr.width, boxSizing: getComputedStyle(wrap).boxSizing },
    input: ir && {
      left: ir.left, right: ir.right, width: ir.width,
      boxSizing: getComputedStyle(input).boxSizing,
      padding: getComputedStyle(input).padding,
      overflowBeyondCardRight: ir.right - r.right,
      overflowBeyondWrapRight: wr ? ir.right - wr.right : null,
    },
    rows: rows && {
      scrollbarWidth: rows.offsetWidth - rows.clientWidth,
      right: rows.getBoundingClientRect().right,
    },
  }
})
console.log(JSON.stringify(data, null, 2))

// Hover a row too: its hover tint clipping tells the same story for .menuRow.
await page.keyboard.press('Escape')
await browser.close()
