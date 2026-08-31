/**
 * Tree-mode + toolbar + selection + search + tooltip regression for
 * BranchMenu's '/' prefix tree:
 *   1. tree activates only when the list is big enough (folder headers),
 *   2. the checked-out branch is visible on open (chain open, or its chain
 *      is a compressed flat row — either way no scrolling to find it),
 *   3. collapsed folders hide their leaves; clicking a header toggles,
 *   4. linear chains compress (feature/haruhi/深度模块/嵌套链路/第三方对接
 *      renders as one header) and deep leaves hide under it,
 *   5. searching KEEPS the ancestor folders, hides non-matching siblings,
 *      highlights the hit substring, and shows the leaf's own segment,
 *   6. the toolbar expands/collapses the whole tree,
 *   7. the IDEA selection model: click selects (blue), Enter stages the
 *      confirm flyout, Escape clears selection tier by tier,
 *   8. double-click on the CURRENT branch closes the menu (the staged
 *      pick on the current branch is a plain close — never switches),
 *   9. hovering a CLIPPED label sets the native title to the full branch
 *      name; a fitting label shows no title; leaving clears it.
 * Repo fixture (branch-style: feature|fix / username / feature-name,
 * generic simulated names — not real business wording):
 *   feature/haruhi/登录鉴权优化
 *   feature/haruhi/接口联调优化
 *   feature/haruhi/数据看板优化
 *   feature/haruhi/深度模块/嵌套链路/第三方对接/{接口适配甲,接口适配乙}
 *   feature/haruhi/这是一个…（超长功能名，悬停测全称）
 *   fix/yuki/订单列表分页优化
 *   fix/yuki/商品详情页缓存
 *   fix/haruhi/支付回调重试机制
 * plus the repo's own branches — total > TREE_MIN_ROWS so the tree shows.
 * Run: node scripts/verify-tree.mjs [port]
 */
import { chromium } from 'playwright-core'

/** Attribute-selector escape for Node context (the CSS global is browser-only). */
const esc = value => value.replace(/[\\"]/g, '\\$&')

const port = process.argv[2] ?? '3080'
const exe = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
let failed = 0
const ok = (label, condition, detail = '') => {
  console.log(`${condition ? 'ok' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!condition) failed = 1
}
page.on('pageerror', err => { console.log(`[pageerror] ${err.message.slice(0, 300)}`); failed = 1 })

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(3500)

await page.getByText('新会话').first().click()
await page.waitForTimeout(2000)

const toggle = page.locator('button').filter({ hasText: /^(工作树|Worktree)$/ }).first()
const chip = toggle.locator('xpath=preceding-sibling::button[1]')
await chip.click()
await page.waitForTimeout(800)

const card = page.locator('div[role="menu"]')
ok('menu open', await card.count() > 0)

// Toolbar present (IDEA posture): locate + expand/collapse-all.
const toolbarButtons = card.locator('button[class*="menuToolButton"]')
ok('toolbar renders two buttons', await toolbarButtons.count() === 2,
  `count=${await toolbarButtons.count()}`)

const groups = card.locator('button[aria-expanded]')
const groupCount = await groups.count()
if (groupCount === 0) {
  console.log('skip: tree inactive — this repo is too small for the prefix tree')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await browser.close()
  console.log(failed === 0 ? 'TREE VERIFY PASSED (skipped)' : 'TREE VERIFY FAILED')
  process.exit(failed)
}
ok('tree active (folder headers render)', groupCount >= 1, `groups=${groupCount}`)

// ── Req 2: current branch visible on open ─────────────────────────────
const chipTitle = (await chip.getAttribute('title')) ?? ''
ok('current branch renderable without expanding', await card.locator(`button[data-branch="${esc(chipTitle)}"]`).count() === 1,
  `branch=${chipTitle}`)
const curAncestors = chipTitle.split('/').filter(s => s !== '').slice(0, -1)
if (curAncestors.length > 0) {
  const chainOk = await page.evaluate(prefixes => {
    const card = document.querySelector('div[role="menu"]')
    if (card === null) return null
    const hits = [...card.querySelectorAll('button[data-group]')]
      .filter(h => prefixes.includes(h.dataset.group ?? ''))
    if (hits.length === 0) return 'no-headers'
    return hits.every(h => h.getAttribute('aria-expanded') === 'true')
  }, curAncestors)
  ok('current-branch chain folders open (or compressed flat)',
    chainOk === true || chainOk === 'no-headers', `chain=${curAncestors.join(' > ')} (${chainOk})`)
} else {
  console.log('skip chain assertion (current branch has no / separator)')
}

const countLeaves = () => card.locator('button[role="menuitem"]').count()

// ── Req 3: collapsed folders hide leaves; header click toggles ────────
const before = await countLeaves()
// `fix` sits outside the current chain (feature/...) so it starts closed.
const fixHdr = card.locator('button[data-group="fix"]')
ok('fix folder header exists', await fixHdr.count() === 1)
await fixHdr.click()
await page.waitForTimeout(400)
const afterExpand = await countLeaves()
ok('expanding a folder reveals its leaves', afterExpand > before, `leaves ${before} -> ${afterExpand}`)
ok('header reports aria-expanded=true', (await fixHdr.getAttribute('aria-expanded')) === 'true')

// ── Req 4: linear chains compress; deep leaves hide under them ────────
const deepHdr = card.locator('button[data-group="feature/haruhi/深度模块/嵌套链路/第三方对接"]')
ok('compressed chain header 深度模块/嵌套链路/第三方对接 exists', await deepHdr.count() === 1,
  await deepHdr.count() === 1 ? `label="${(await deepHdr.textContent())?.trim()}"` : '')
ok('deep leaves hidden (no flat 接口适配甲 row yet)',
  await card.locator('button[data-branch="feature/haruhi/深度模块/嵌套链路/第三方对接/接口适配甲"]').count() === 0)
await deepHdr.click()
await page.waitForTimeout(300)
ok('deep leaf appears after expanding the chain header',
  await card.locator('button[data-branch="feature/haruhi/深度模块/嵌套链路/第三方对接/接口适配甲"]').count() === 1)
await deepHdr.click()
await page.waitForTimeout(300)

// ── Req 5: search keeps ancestors, hides siblings, highlights ─────────
const input = card.locator('input')
await input.fill('第三方对接')
await page.waitForTimeout(300)
const hitRow = card.locator('button[data-branch="feature/haruhi/深度模块/嵌套链路/第三方对接/接口适配甲"]')
ok('search finds a row inside a collapsed folder', await hitRow.count() === 1)
const searchLabel = (await hitRow.textContent())?.trim() ?? ''
ok('search leaf shows only its own segment', searchLabel === '接口适配甲', JSON.stringify(searchLabel))
const ancestorCount = await card.locator(
  '[data-group="feature"], [data-group="feature/haruhi"], [data-group="feature/haruhi/深度模块"], [data-group="feature/haruhi/深度模块/嵌套链路"], [data-group="feature/haruhi/深度模块/嵌套链路/第三方对接"]',
).count()
ok('search keeps the ancestor folders', ancestorCount === 5, `ancestors=${ancestorCount}`)
ok('search hides non-matching siblings', await card.locator('button[data-branch="fix/yuki/订单列表分页优化"]').count() === 0)
ok('search highlights the hit substring', await card.locator('span[class*="menuSearchMark"]').count() >= 1)
await page.screenshot({ path: 'scripts/verify-tree-1-search.png' })

// ── Req 6: toolbar expand/collapse all ────────────────────────────────
await input.fill('')
await page.waitForTimeout(300)
const expandBtn = card.locator('button[title="全部展开"], button[title="Expand all"]').first()
ok('expand-all button present', await expandBtn.count() === 1)
await expandBtn.click()
await page.waitForTimeout(300)
const allOpen = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  const headers = [...card.querySelectorAll('button[aria-expanded]')]
  return headers.length > 0 && headers.every(h => h.getAttribute('aria-expanded') === 'true')
})
ok('expand-all opens every folder', allOpen)
const collapseBtn = card.locator('button[title="全部折叠"], button[title="Collapse all"]').first()
ok('collapse-all button appears after expanding', await collapseBtn.count() === 1)
await collapseBtn.click()
await page.waitForTimeout(300)
const allClosed = await page.evaluate(() => {
  const card = document.querySelector('div[role="menu"]')
  const headers = [...card.querySelectorAll('button[aria-expanded]')]
  return headers.length > 0 && headers.every(h => h.getAttribute('aria-expanded') === 'false')
})
ok('collapse-all closes every folder', allClosed)

// ── Req 7: selection model ────────────────────────────────────────────
const someRow = card.locator('button[data-branch="main"]')
await someRow.click()
await page.waitForTimeout(200)
ok('click selects the row', await someRow.evaluate(b => b.className.includes('menuRowPicked')))
// The collapse-all above folded the current chain — reopen it so the HEAD
// row is on screen to check its tint next to the selection.
const featureHdr0 = card.locator('button[data-group="feature"]')
if (await featureHdr0.getAttribute('aria-expanded') === 'false') {
  await featureHdr0.click()
  await page.waitForTimeout(300)
}
const headRow = card.locator(`button[data-branch="${esc(chipTitle)}"]`)
ok('HEAD row keeps its own tint next to a selection', await headRow.evaluate(b => b.className.includes('menuRowSelected')))
// Enter stages the confirm flyout for the selected row.
await someRow.press('Enter')
await page.waitForTimeout(600)
ok('Enter on selected row opens the confirm flyout',
  await page.evaluate(() => document.querySelector('[role="dialog"]') !== null))
// Escape tier 1: cancel confirm; tier 2: clear selection (menu stays).
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const afterSelEsc = await page.evaluate(() => ({
  fly: document.querySelector('[role="dialog"]') !== null,
  menu: document.querySelector('div[role="menu"]') !== null,
  picked: [...document.querySelectorAll('div[role="menu"] button')].some(b => b.className.includes('menuRowPicked')),
}))
ok('Escape cancels confirm then clears selection', afterSelEsc.fly === false && afterSelEsc.menu === true && afterSelEsc.picked === false,
  JSON.stringify(afterSelEsc))

// ── Req 9: hover tooltip ──────────────────────────────────────────────
// Expand the current branch's chain (feature) so the long leaf is reachable.
const featureHdr = card.locator('button[data-group="feature"]')
if (await featureHdr.getAttribute('aria-expanded') === 'false') {
  await featureHdr.click()
  await page.waitForTimeout(300)
}
await card.locator('button[data-group="feature/haruhi"]').click()
await page.waitForTimeout(300)
const longRow = card.locator('button[role="menuitem"][data-branch^="feature/haruhi/这是一个"]')
ok('long-name leaf renders inside feature/haruhi', await longRow.count() === 1)
await longRow.scrollIntoViewIfNeeded()
await longRow.hover()
await page.waitForTimeout(250)
const titleHover = await longRow.locator('span').first().getAttribute('title')
ok('clipped label gets the full name as title on hover',
  titleHover !== null && titleHover.startsWith('feature/haruhi/这是一个'), titleHover === null ? 'no title' : JSON.stringify(titleHover.slice(0, 30)))

await card.locator('button[data-group="feature/haruhi"]').hover()
await page.waitForTimeout(250)
const titleLeave = await longRow.locator('span').first().getAttribute('title')
ok('title cleared after leaving the row', titleLeave === null || titleLeave === '', JSON.stringify(titleLeave))

const yukiHdr = card.locator('button[data-group="fix/yuki"]')
await yukiHdr.click()
await page.waitForTimeout(300)
const shortRow = card.locator('button[data-branch="fix/yuki/订单列表分页优化"]')
await shortRow.scrollIntoViewIfNeeded()
await shortRow.hover()
await page.waitForTimeout(250)
const titleShort = await shortRow.locator('span').first().getAttribute('title')
ok('fitting label shows no title', titleShort === null || titleShort === '', JSON.stringify(titleShort))
await page.screenshot({ path: 'scripts/verify-tree-2-tooltip.png' })

// ── Req 8: double-click stages the flyout; on the CURRENT branch the
// staged pick just closes the menu (never switches the repo HEAD) ──────
await card.locator(`button[data-branch="${esc(chipTitle)}"]`).dblclick()
await page.waitForTimeout(400)
ok('double-click on current closes the menu', await card.count() === 0)

await browser.close()
console.log(failed === 0 ? 'TREE VERIFY PASSED' : 'TREE VERIFY FAILED')
process.exit(failed)