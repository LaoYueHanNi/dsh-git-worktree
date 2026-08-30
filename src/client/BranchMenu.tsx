/**
 * BranchMenu: the branch picker popup anchored to the composer branch chip.
 * The base Menu primitive exposes neither a height cap nor a search field,
 * so with many branches its portal list fills the viewport — this popup
 * replaces it with an owner-styled card: Menu's card chrome (r12, inverted
 * hairline, shadow-lv3, --dsw-specific-menu, see .menuCard) on a
 * portal-fixed posture, with owner requirements baked in:
 *
 *   1. the card is capped at min(420px, 60vh) and only the branch rows
 *      scroll (heading, search, and the toolbar stay pinned);
 *   2. a search field is pinned at the card's bottom edge — the row list
 *      scrolls above it — filtering rows by case-insensitive substring
 *      while KEEPING the matching branches' ancestor folders (IDEA-style
 *      prune) and highlighting the hit substring;
 *   3. the card opens entirely above the chip: the CSS `bottom` pins its
 *      bottom edge ~6px above the chip's top, so it grows upward and can
 *      never cover the composer, whatever the branch count.
 *
 * Layout (IDEA branch-panel posture at popup scale): a narrow tool strip
 * on the left (locate-current + expand/collapse-all + new-branch), then a
 * main column of heading / tree / search. Selection model borrowed from
 * IDEA: a single click SELECTS a row (blue); double-click or Enter then OPENS the
 * right-side confirm flyout for that row — the switch itself always goes
 * through the confirmation step, never straight away. While the confirm
 * flyout is open, clicking another row re-anchors it (the old one-click
 * pick flow).
 *
 * The new-branch tool (the toolbar's plus) opens the create flyout to the
 * RIGHT of the card (the confirm flyout's submenu posture): the flyout
 * holds the naming input — validated as you type (git ref-name rules plus
 * a duplicate check against the rows) with a live hint naming the issue
 * or, while the draft is acceptable, the branch the cut starts from — and
 * the Cancel/Create pair. Confirming fires the create in ONE stroke
 * (create AND in-place switch; no second confirm step — typing the name
 * into the flyout and pressing Create IS the intent). While the create
 * runs the flyout freezes (busy disables input and buttons); a failure
 * toasts and leaves the flyout open for a renamed retry.
 * The confirm flyout is a second-level portal opening to the RIGHT of the
 * branch card (the base Menu's submenu posture): the chip sits in the
 * bottom composer, so the old below-the-chip bubble landed off-viewport.
 * The flyout is a separate portal (not clipped by the card's
 * overflow:hidden), horizontally anchored to the card's right edge — it
 * can never overlap the branch list — and vertically centered on the
 * picked row. Its width is content-driven, capped in CSS, wrapping.
 *
 * Close semantics: outside pointerdown (card, flyouts, and chip excluded)
 * cancels the confirm and closes the menu; Escape unwinds tier by tier —
 * confirm, then the create flyout, then search text, then selection, then
 * the menu; Enter in the search field commits the first enabled visible row.
 *
 * Long names and many branches: a clipped label shows the full name on
 * hover via the native title (gated to actually-clipped rows only). The
 * list ALWAYS renders as a full-depth '/' prefix tree: folder-header rows
 * (chevron + count) toggle; under an expanded folder, child rows show only
 * their own segment (indentation carries the hierarchy — no repeated path,
 * no color distinction); linear chains compress into one row. TREE_MIN_ROWS
 * only sets the DEFAULT opening depth: past it, just the checked-out
 * branch's chain starts open (centering still lands it mid-viewport); at
 * or under it, every folder starts open — few branches have nothing to hide.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconGoalOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { branchNameIssue } from '../normalize.ts'
import css from './BranchChip.module.css'

/** One selectable branch row (disabled = checked out by a live worktree). */
export interface BranchRow {
  name: string
  disabled: boolean
}

/** The confirm flyout bundle, owned and localized by the caller. */
export interface BranchConfirmFly {
  /** Ask line (already localized). */
  ask: string
  /** Confirm-button label (progress text while busy). */
  confirmLabel: string
  /** Cancel-button label. */
  cancelLabel: string
  /** True while the action runs: both buttons disable. */
  busy: boolean
  /** Run the confirmed action. */
  onConfirm: () => void
  /** Dismiss the flyout without acting (stays on the open menu). */
  onCancel: () => void
}

/** Full props: anchor + data + confirm bundle + callbacks + locale seat. */
export interface BranchMenuProps {
  /** Whether the popup shows. */
  open: boolean
  /** The chip element — the popup's bottom edge pins just above its top. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Every local branch as a row (occupancy-disabled rows included). */
  rows: readonly BranchRow[]
  /** The branch currently checked out (trailing check, HEAD tint). */
  currentBranch: string
  /** Non-null while a picked branch awaits confirmation. */
  confirm: BranchConfirmFly | null
  /** Stage a pick (starts the confirm flyout beside that row). Current
   * branch re-select closes the menu unless the owner stages otherwise. */
  onSelect: (branch: string) => void
  /** Whether the new-branch tool is offered (worktree mode routes creation
   * through the cutout flow instead — the toolbar plus then disables). */
  canCreate: boolean
  /** Run the create NOW (create AND in-place switch): the flyout's Create
   * button fires this once for a valid draft — no second confirm step. */
  onCreate: (name: string) => void
  /** True while the create runs: the flyout freezes (input and buttons
   * disable, the Create button shows progress text). */
  busy: boolean
  /** Sync remote-tracking refs (fetch every remote + prune); the owner
   * refreshes the rows when it lands — the menu stays open. */
  onFetch: () => void
  /** True while the remote sync runs: the fetch tool disables. */
  fetchBusy: boolean
  /** Dismiss the menu (outside click, Escape with nothing open). */
  onClose: () => void
  /** Bound locale translate (placeholder, empty state, heading, toolbar). */
  t: PropsLocale<'git-worktree'>['t']
}

/** Viewport edge clearance, mirroring the base Menu portal margin. */
const MARGIN = 12
/** Gap kept between the chip's top edge and the card's bottom edge. */
const GAP = 6
/** Design card width — the CSS width's px arm; used for horizontal clamping. */
const CARD_WIDTH = 360
/** Design flyout width cap — matches .popCard's max-width arm. */
const FLY_MAX_WIDTH = 400
/** After a folder toggle, clicks arriving within this window are swallowed
 * (double-click misfire guard — see shiftGuardUntil in the component). */
const CLICK_GUARD_MS = 250
/** Unplaced flyout: hidden but laid out at a fixed origin so offsetWidth/
 * offsetHeight are real for the measure-then-place pass (base Menu trick). */
const FLY_MEASURE: Partial<CSSStyleDeclaration> = { left: '-9999px', top: '0px', visibility: 'hidden' }

/** Past this many rows the tree starts with ONLY the checked-out branch's
 * chain open; at or under it every folder starts open (few branches have
 * nothing to hide). The tree itself always renders — this threshold is
 * about the default opening depth, never about flat vs tree. */
const TREE_MIN_ROWS = 8

/** One node of the '/' prefix tree built from the row list: every segment
 * boundary is a folder level, so `feature/x/y` nests under `feature` and
 * `x`, and the leaves (rows) sit at the terminal nodes. */
interface TreeNode {
  /** This node's own segment (the label text). */
  segment: string
  /** Full path: segments joined by '/'. Empty only at the root list. */
  path: string
  /** Depth from the root (root children are depth 0). */
  depth: number
  /** The branch named exactly `path`, if any — may coexist with children
   * (`feature` plus `feature/x` are both legal git branch names). */
  leaf: BranchRow | null
  /** Children, sorted folders-first then by segment. */
  children: TreeNode[]
  /** Leaf branches under this node, including its own leaf. */
  total: number
}

/** Every folder path that renders a header, walking the tree depth-first. */
function collectFolderPaths(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children.length > 0) {
      out.push(node.path)
      collectFolderPaths(node.children, out)
    }
  }
  return out
}

const segCmp = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Build the prefix tree of the rows (see TreeNode). */
function buildTree(rows: readonly BranchRow[]): TreeNode[] {
  /** Mutable builder node — same shape as TreeNode but built incrementally
   * (find-by-segment walks), sorted and totalled at the end. */
  interface M {
    segment: string
    path: string
    depth: number
    leaf: BranchRow | null
    children: M[]
    total: number
  }
  const root: M[] = []
  const find = (level: M[], segment: string): M | undefined =>
    level.find(n => n.segment === segment)
  for (const row of rows) {
    const segs = row.name.split('/').filter(s => s !== '')
    let level = root
    let path = ''
    for (let i = 0; i < segs.length; i += 1) {
      path = path === '' ? segs[i] : `${path}/${segs[i]}`
      let node = find(level, segs[i])
      if (node === undefined) {
        node = { segment: segs[i], path, depth: i, leaf: null, children: [], total: 0 }
        level.push(node)
      }
      if (i === segs.length - 1) node.leaf = row
      level = node.children
    }
  }
  const finish = (nodes: M[]): void => {
    for (const node of nodes) finish(node.children)
    nodes.sort((a, b) => {
      const af = a.children.length > 0 ? 0 : 1
      const bf = b.children.length > 0 ? 0 : 1
      return af !== bf ? af - bf : segCmp(a.segment, b.segment)
    })
  }
  finish(root)
  const count = (nodes: M[]): void => {
    for (const node of nodes) {
      count(node.children)
      node.total = (node.leaf === null ? 0 : 1)
        + node.children.reduce((sum, c) => sum + c.total, 0)
    }
  }
  count(root)
  return root as unknown as TreeNode[]
}

/** The folders that must start expanded so the checked-out branch is
 * immediately visible in the tree: every proper ancestor of its path. */
function chainExpanded(branch: string): Set<string> {
  const segs = branch.split('/').filter(s => s !== '')
  const set = new Set<string>()
  let path = ''
  for (let i = 0; i < segs.length - 1; i += 1) {
    path = path === '' ? segs[i] : `${path}/${segs[i]}`
    set.add(path)
  }
  return set
}

/** Hover tooltip: set the native `title` ONLY when the label is actually
 * clipped (scrollWidth > clientWidth) — fitted names show no tooltip, and
 * long ones expose their full path without a custom bubble. The target is
 * the label span (first span child), the clipped element. */
const gateTooltip = (button: HTMLButtonElement, name: string): void => {
  const label = button.querySelector<HTMLElement>(':scope > span')
  if (label !== null) label.title = label.scrollWidth > label.clientWidth ? name : ''
}

/** Leaving a row drops its tooltip so a recycled DOM node (search refilter)
 * can never show a stale title for another branch. */
const clearTooltip = (button: HTMLButtonElement): void => {
  const label = button.querySelector<HTMLElement>(':scope > span')
  if (label !== null) label.title = ''
}

/**
 * Render the upward branch picker with its right-side confirm flyout.
 * @param props - anchor, rows, confirm bundle, callbacks, and the class sheet.
 * @returns null while closed or unplaced; otherwise the portaled card (+flyout).
 */
export function BranchMenu({
  open, anchorRef, rows, currentBranch, confirm, onSelect, canCreate, onCreate, busy, onFetch, fetchBusy, onClose, t,
}: BranchMenuProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /**
   * Search-field ref callback: focus the field the moment it mounts. The
   * card mounts in two stages (open flips, then pos resolves a render
   * later), so an [open]-keyed passive effect fires while the input is
   * still unmounted — its focus() no-ops against a null ref. Focusing at
   * mount time is immune to that race by construction.
   */
  /**
   * Search-field ref callback: focus the field the moment it mounts. The
   * card mounts in two stages (open flips, then pos resolves a render
   * later), so an [open]-keyed passive effect fires while the input is
   * still unmounted — its focus() no-ops against a null ref. Focusing at
   * mount time is immune to that race by construction. The callback MUST
   * be referentially stable: a fresh closure per render makes React
   * detach and re-attach it on every commit, and the re-attach runs
   * focus() again — each re-render (a click selection, a status refresh,
   * a sessions push) would yank focus back to the field, flickering its
   * focus tint. Stable identity = attach happens only at mount.
   */
  const holdSearchFocus = useCallback((el: HTMLInputElement | null): void => {
    inputRef.current = el
    if (el !== null) el.focus()
  }, [])
  /** Same mount-time focus trick for the new-branch input: the form mounts
   * when the toolbar plus flips `creating`, mid-card-lifecycle, so the ref
   * callback is the only reliable focus point. Stable for the same reason
   * as holdSearchFocus — typing would otherwise re-focus on every render. */
  const holdCreateFocus = useCallback((el: HTMLInputElement | null): void => {
    if (el !== null) el.focus()
  }, [])
  const flyRef = useRef<HTMLDivElement>(null)
  const flyConfirmRef = useRef<HTMLButtonElement | null>(null)
  /** The row whose pick is awaiting confirmation (anchoring element). */
  const pendingRef = useRef<{ name: string; el: HTMLElement } | null>(null)
  /** Pending row's name — the placement-effect trigger: picking another
   * row while the flyout is open must re-anchor it (confirmOpen alone
   * stays true, so a ref mutation re-renders nothing). */
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const [flyPos, setFlyPos] = useState<{ left: number; top: number } | null>(null)
  const [query, setQuery] = useState('')
  /** Expanded folder set, keyed by node path. Re-seeded on every open so
   * the current branch's chain is visible without re-expanding by hand. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  /** IDEA-style selection: clicked row (blue). Zero or one at a time. */
  const [selected, setSelected] = useState<string | null>(null)
  /** The create flyout: open flag plus the live draft. Opening the menu
   * (or closing the flyout) resets both — see the open-reset effect. */
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  /** The create flyout element and its placed position (see its place
   * pass below; same measure-then-place posture as the confirm flyout). */
  const createFlyRef = useRef<HTMLDivElement | null>(null)
  const [createFlyPos, setCreateFlyPos] = useState<{ left: number; top: number } | null>(null)

  // Latest values for stable-effect listeners (the parent rebuilds the
  // confirm object each render; refs keep the document-level keydown and
  // outside-click handlers from going stale on the closure they captured).
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  const queryRef = useRef(query)
  queryRef.current = query
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  /** Fresh creating flag for the stale-safe document keydown listener. */
  const creatingRef = useRef(creating)
  creatingRef.current = creating
  /** Latest rows for the open-reset effect: the effect must NOT re-run when
   * a mid-open refresh swaps the rows (that would reset folders the user
   * has toggled), but the reset itself still needs the freshest list. */
  const latestRows = useRef(rows)
  latestRows.current = rows
  /** Always-fresh pick for the stale-safe document keydown listener. */
  const pickRef = useRef<(el: HTMLElement | null, name: string) => void>(() => {})
  const confirmOpen = confirm !== null

  /**
   * Double-click misfire guard: toggling a folder shifts the layout — the
   * second click of a double-click can land on a row that slid under the
   * cursor (a branch!), which would select it or pop the switch flyout.
   * After a folder toggle, every click swallowed for CLICK_GUARD_MS, so a
   * double-click on a folder expands it exactly once and never bleeds into
   * a branch click. Branch-row clicks do not arm the guard (selecting does
   * not move anything), so row double-clicks keep working instantly.
   */
  const shiftGuardUntil = useRef(0)
  const guardActive = (): boolean => Date.now() < shiftGuardUntil.current
  const armShiftGuard = (): void => { shiftGuardUntil.current = Date.now() + CLICK_GUARD_MS }

  /** Stage a pick: remember the row element (the flyout anchors beside
   * it), then hand the branch to the owner. All pick paths — search Enter,
   * keyboard Enter on a selected row — funnel through here. */
  const pick = (el: HTMLElement | null, name: string): void => {
    if (el !== null) pendingRef.current = { name, el }
    setPendingName(name)
    onSelect(name)
  }
  pickRef.current = pick

  /** The '/' prefix tree of the rows — always on; TREE_MIN_ROWS only sets
   * the default opening depth (see the open-reset effect). */
  const tree = useMemo(() => buildTree(rows), [rows])

  /** Every folder path that renders a header — the expand/collapse-all
   * button's scope. */
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree])
  const allExpanded = folderPaths.length > 0 && folderPaths.every(p => expanded.has(p))
  const toggleAll = (): void => {
    setExpanded(allExpanded ? new Set() : new Set(folderPaths))
  }
  const locateCurrent = (): void => {
    // Locate, don't restructure: only ADD the current branch's ancestor
    // folders if they happen to be closed (the row must exist to scroll
    // to it) — folders the user expanded/collapsed stay untouched. Then
    // center the row one frame later, once the re-render has committed.
    setExpanded(prev => {
      const next = new Set(prev)
      for (const p of chainExpanded(currentBranch)) next.add(p)
      return next
    })
    requestAnimationFrame(() => {
      if (rowsRef.current !== null) centerCurrentRow(rowsRef.current)
    })
  }

  // Every open starts from a clean filter, selection, tree state, and
  // naming form. The tree's opening depth follows the list size: past
  // TREE_MIN_ROWS only the checked-out branch's chain starts open, at or
  // under it every folder does. Rows come through a ref — the effect keys
  // on [open, currentBranch] so a mid-open refresh never resets folders the
  // user has toggled by hand.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(null)
    setCreating(false)
    setDraft('')
    const currentRows = latestRows.current
    setExpanded(
      currentRows.length > TREE_MIN_ROWS
        ? chainExpanded(currentBranch)
        : new Set(collectFolderPaths(buildTree(currentRows))),
    )
  }, [open, currentBranch])

  // A selection that no longer exists in the rows (worktree toggle, refresh)
  // must not linger as a phantom Enter target.
  useEffect(() => {
    if (selected !== null && !rows.some(r => r.name === selected)) setSelected(null)
  }, [rows, selected])

  /** Toggle one folder header. */
  const toggle = (path: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Pin above the chip on open and on viewport movement while open. CSS
  // `bottom` pinning means the card grows upward from that edge without
  // measuring its own height; the width is fixed by CSS, so the horizontal
  // clamp is deterministic.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = (): void => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const rect = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, vw - CARD_WIDTH - MARGIN))
      setPos({ left, bottom: vh - rect.top + GAP })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef])

  // Land the current-branch row mid-viewport when the list shows. With
  // dozens of branches the row otherwise drowns off-screen and "where am
  // I?" becomes a scroll hunt. Two trigger paths, both required:
  //
  //   - rows MOUNT: the card mounts in two stages (open flips, pos
  //     resolves a render later), so an [open]-keyed effect runs while
  //     nothing is mounted and never re-fires once rows appear — the
  //     stable mount-signal ref below fires exactly at mount instead;
  //   - filter CLEARS back to the full list: the rows container is
  //     long-mounted by then, so a plain [query] effect reaches it.
  //
  // Manual scrollTo on the rows container — scrollIntoView would also drag
  // scrollable ancestors. Re-renders must NOT re-center (it would yank the
  // user's scroll during picks), hence the stable useCallback identity.
  const rowsRef = useRef<HTMLElement | null>(null)
  const centerCurrentRow = useCallback((viewport: HTMLElement): void => {
    const row = [...viewport.querySelectorAll<HTMLButtonElement>('button[role="menuitem"][data-branch]')]
      .find(b => (b.dataset.branch ?? '') === currentBranch)
    if (row === undefined) return
    const rowRect = row.getBoundingClientRect()
    const vpRect = viewport.getBoundingClientRect()
    const target = viewport.scrollTop + (rowRect.top - vpRect.top) - (viewport.clientHeight - rowRect.height) / 2
    viewport.scrollTo({ top: Math.max(0, target) })
  }, [currentBranch])
  const holdRowsCenter = useCallback((el: HTMLElement | null): void => {
    rowsRef.current = el
    if (el !== null) centerCurrentRow(el)
  }, [centerCurrentRow])
  useEffect(() => {
    if (!open || query.trim() !== '') return
    if (rowsRef.current !== null) centerCurrentRow(rowsRef.current)
  }, [open, query, centerCurrentRow])

  // After an open re-seeds the folder chain (see the reset effect above),
  // its re-render commits one render AFTER the rows mount — centering in
  // that window would no-op because the current row's folder is still
  // closed. One frame later the chain is committed and the row exists, so
  // run the centering again then. User folder toggles never re-center:
  // this effect fires only on open / branch change.
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      if (rowsRef.current !== null) centerCurrentRow(rowsRef.current)
    })
    return () => { cancelAnimationFrame(raf) }
  }, [open, centerCurrentRow])

  // Flyout lifecycle: horizontally anchored to the card's right edge (so
  // it never overlaps the branch list), vertically centered on the picked
  // row, clamped into the viewport. Width is content-driven: place()
  // clamps the flyout's inline max-width to the room right of the card
  // (CSS caps the design width), then measures the laid-out hidden flyout
  // and pins it. Re-runs when the pending ROW changes — confirmOpen alone
  // stays true across re-picks, which used to leave the flyout stranded
  // at the first row. Scroll/resize re-fit while open.
  useLayoutEffect(() => {
    if (!confirmOpen || pendingName === null) {
      setFlyPos(null)
      return
    }
    const place = (): void => {
      const pending = pendingRef.current
      const fly = flyRef.current
      const card = cardRef.current
      if (pending === null || fly === null || card === null) return
      const row = pending.el.getBoundingClientRect()
      const cr = card.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = cr.right + GAP
      // Fit the right side: content width first, clamped by the room left
      // of the viewport margin (floor keeps the buttons usable on very
      // narrow windows, at the cost of spilling past the margin).
      const room = Math.min(FLY_MAX_WIDTH, Math.max(200, vw - MARGIN - left))
      fly.style.maxWidth = `${room}px`
      const fw = fly.offsetWidth
      const fh = fly.offsetHeight
      // The picked row's center rides the flyout's vertical center.
      const top = Math.min(
        Math.max(row.top + row.height / 2 - fh / 2, MARGIN),
        Math.max(MARGIN, vh - fh - MARGIN),
      )
      setFlyPos({ left: Math.min(left, vw - MARGIN - fw), top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [confirmOpen, pendingName])

  // Create flyout placement: anchored to the card's right edge (never
  // overlapping the branch list), vertically centered on the card, clamped
  // into the viewport. Content-driven width via the same measure-then-place
  // pass the confirm flyout uses (hidden layout, then real offsets).
  useLayoutEffect(() => {
    if (!creating) {
      setCreateFlyPos(null)
      return
    }
    const place = (): void => {
      const fly = createFlyRef.current
      const card = cardRef.current
      if (fly === null || card === null) return
      const cr = card.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = cr.right + GAP
      const room = Math.min(FLY_MAX_WIDTH, Math.max(200, vw - MARGIN - left))
      fly.style.maxWidth = `${room}px`
      const fw = fly.offsetWidth
      const fh = fly.offsetHeight
      const top = Math.min(
        Math.max(cr.top + cr.height / 2 - fh / 2, MARGIN),
        Math.max(MARGIN, vh - fh - MARGIN),
      )
      setCreateFlyPos({ left: Math.min(left, vw - MARGIN - fw), top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [creating])

  // Confirm opens (or re-anchors to another row) → focus the confirm
  // button (Enter commits, Escape cancels); confirm closes → forget the
  // pending row anchor. The focus rides a rAF: the flyout mounts in the
  // hidden measure-then-place posture, and focus() on a visibility:hidden
  // element is a no-op — one frame later the placed card is visible and
  // the focus lands.
  useEffect(() => {
    if (confirmOpen && pendingName !== null) {
      const raf = requestAnimationFrame(() => { flyConfirmRef.current?.focus() })
      return () => { cancelAnimationFrame(raf) }
    }
    if (!confirmOpen) {
      pendingRef.current = null
      setPendingName(null)
    }
  }, [confirmOpen, pendingName])

  // Outside pointer / keyboard dismiss. Outside clicks cancel the confirm
  // and close the menu in one go. Escape unwinds tier by tier — confirm,
  // then search text, then selection, then the menu. Arrow keys move the
  // selection over the visible leaf rows and Enter stages the confirm,
  // but only while focus sits on a card button: the search input keeps
  // its own caret handling and Enter-commit.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (cardRef.current?.contains(event.target as Node) === true) return
      if (flyRef.current?.contains(event.target as Node) === true) return
      if (createFlyRef.current?.contains(event.target as Node) === true) return
      if (anchorRef.current?.contains(event.target as Node) === true) return
      confirmRef.current?.onCancel()
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key
      if (key === 'Escape') {
        if (confirmRef.current !== null) { confirmRef.current.onCancel(); return }
        if (creatingRef.current) { setCreating(false); setDraft(''); return }
        if (queryRef.current.trim() !== '') { setQuery(''); return }
        if (selectedRef.current !== null) { setSelected(null); return }
        onClose()
        return
      }
      const card = cardRef.current
      const active = document.activeElement
      if (card === null || active === null || !card.contains(active)) return
      const inputs = card.querySelectorAll('input')
      if (inputs.length > 0 && [...inputs].includes(active as HTMLInputElement)) return
      const leaves = [...card.querySelectorAll<HTMLButtonElement>('button[role="menuitem"][data-branch]')]
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault()
        if (leaves.length === 0) return
        const idx = leaves.findIndex(b => (b.dataset.branch ?? '') === selectedRef.current)
        let next = idx
        if (key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(leaves.length - 1, idx + 1)
        else next = idx <= 0 ? leaves.length - 1 : idx - 1
        const target = leaves[next]
        const name = target.dataset.branch ?? null
        if (name !== null) setSelected(name)
        target.focus()
        target.scrollIntoView({ block: 'nearest' })
      } else if (key === 'Enter' && selectedRef.current !== null) {
        event.preventDefault()
        const el = leaves.find(b => (b.dataset.branch ?? '') === selectedRef.current) ?? null
        pickRef.current(el, selectedRef.current)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, anchorRef])

  if (!open || pos === null) return null

  const needle = query.trim().toLowerCase()
  const visible = needle === ''
    ? rows
    : rows.filter(row => row.name.toLowerCase().includes(needle))

  /** Enter in the search field: commit the first enabled visible row
   * (its rendered button is the anchor — found by its data-branch key; the
   * label text alone can't identify a row inside a tree). */
  const commitFirst = (): void => {
    const first = visible.find(row => !row.disabled)
    if (first === undefined) return
    const card = cardRef.current
    if (card === null) return
    const el = card.querySelector<HTMLButtonElement>(`button[data-branch="${CSS.escape(first.name)}"]`)
    pick(el, first.name)
  }

  /** New-branch draft validation: git ref-name rules first, then a duplicate
   * check against the rows (locals only — those ARE the rows). */
  const createIssue = branchNameIssue(draft)
  const createDuplicate = createIssue === null && rows.some(row => row.name === draft)
  const createValid = createIssue === null && !createDuplicate
  /** Error line under the input, ONLY while the draft is unacceptable with
   * a non-empty reason (the ask line above already names the cut point, and
   * an untouched input needs no error) — the Create button disables in
   * lockstep. */
  const createHint = createDuplicate ? t('menuNewBranchExists') : t('menuNewBranchBad')
  const showCreateHint = (createIssue !== null && createIssue !== 'empty') || createDuplicate

  /** Fire the create in one stroke — the flyout's whole point. Invalid
   * drafts and a running create are no-ops (the Create button disables in
   * lockstep); the owner closes the menu on success, toasts on failure and
   * leaves the flyout open for a renamed retry. */
  const commitCreate = (): void => {
    if (!createValid || busy) return
    onCreate(draft)
  }

  /** Row class composition: base + HEAD tint + selection (selection wins). */
  const rowClass = (name: string): string => {
    let cls = css.menuRow
    if (name === currentBranch) cls += ` ${css.menuRowSelected}`
    if (name === selected) cls += ` ${css.menuRowPicked}`
    return cls
  }

  /** A row's click behavior: with the confirm flyout open, clicking a row
   * re-picks it (the old one-click flow — the flyout re-anchors); without
   * one it just selects (IDEA model — double-click or Enter opens the
   * confirm flyout for the selected row). */
  const rowClick = (el: HTMLButtonElement, name: string): void => {
    if (confirmOpen) pick(el, name)
    else setSelected(name)
  }

  /** Wrap every case-insensitive occurrence of `needle` in `text` with the
   * search-mark span (IDEA-style hit highlight). */
  const renderLabel = (text: string): React.ReactNode => {
    if (needle === '') return text
    const out: React.ReactNode[] = []
    let rest = text
    let key = 0
    for (;;) {
      const idx = rest.toLowerCase().indexOf(needle)
      if (idx === -1) { out.push(rest); break }
      if (idx > 0) out.push(rest.slice(0, idx))
      out.push(<span key={key} className={css.menuSearchMark}>{rest.slice(idx, idx + needle.length)}</span>)
      key += 1
      rest = rest.slice(idx + needle.length)
    }
    return out
  }

  /** Does any leaf under these nodes match the needle? */
  const subtreeMatches = (nodes: TreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.leaf !== null && node.leaf.name.toLowerCase().includes(needle)) return true
      if (subtreeMatches(node.children)) return true
    }
    return false
  }

  /** One tree group-header row: its own segment (a compressed chain's
   * walked segments join the label), a count badge, and a chevron that
   * turns for expansion. Clicking toggles. One color throughout — the
   * folder path is not color-distinguished from the name. */
  const renderHeader = (node: TreeNode, label: string, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.path)
    return (
      <button
        key={`group:${node.path}`}
        type="button"
        className={css.menuGroup}
        data-group={node.path}
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-expanded={isOpen}
        onClick={() => {
          if (guardActive()) return
          toggle(node.path)
          armShiftGuard()
        }}
      >
        <IconChevronRightOutline14
          size={12}
          className={isOpen ? `${css.menuGroupChevron} ${css.menuGroupChevronOpen}` : css.menuGroupChevron}
        />
        <span className={css.menuGroupLabel}>{label}</span>
        <span className={css.menuGroupCount}>({node.total})</span>
      </button>
    )
  }

  /** One tree leaf row: under an expanded folder it shows only its own
   * segment (indentation carries the hierarchy — no repeated full path);
   * a compressed linear chain keeps its walked segments in the label so
   * the context survives without a pointless one-entry folder. */
  const renderLeaf = (node: TreeNode, label: string, depth: number): React.ReactNode => (
    <button
      key={node.path}
      type="button"
      role="menuitem"
      data-branch={node.path}
      className={rowClass(node.path)}
      disabled={node.leaf?.disabled ?? false}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => { if (guardActive()) return; rowClick(buttonOf(node.path), node.path) }}
      onDoubleClick={(event) => { if (guardActive()) return; pick(event.currentTarget, node.path) }}
      onMouseEnter={(event) => { gateTooltip(event.currentTarget, node.path) }}
      onMouseLeave={(event) => { clearTooltip(event.currentTarget) }}
    >
      <span className={css.menuRowLabel}>{label}</span>
      {node.path === currentBranch && <IconCheckOutline16 size={14} />}
    </button>
  )

  /** Recursive tree renderer. Linear chains — nodes that are neither a
   * branch nor a real fork — compress into the next row's label, so
   * `feature/优化` stays a single flat row instead of a pointless one-entry
   * folder, while a real fork (`a/deep/tree` holding leaf1+leaf2) gets a
   * header whose children show only their own segments. */
  const renderTree = (nodes: TreeNode[], depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (const node of nodes) {
      let cur = node
      const parts: string[] = []
      while (cur.leaf === null && cur.children.length === 1) {
        parts.push(cur.segment)
        cur = cur.children[0]
      }
      const label = parts.length === 0 ? cur.segment : `${parts.join('/')}/${cur.segment}`
      if (cur.leaf !== null) {
        out.push(renderLeaf(cur, label, depth))
        // A branch that is also a folder path (`feature` next to
        // `feature/x`): keep the pickable row and fold the children under
        // a second, toggle-only header of the same name (rare coexistence).
        if (cur.children.length > 0) {
          out.push(renderHeader(cur, label, depth))
          if (expanded.has(cur.path)) out.push(...renderTree(cur.children, depth + 1))
        }
      } else {
        out.push(renderHeader(cur, label, depth))
        if (expanded.has(cur.path)) out.push(...renderTree(cur.children, depth + 1))
      }
    }
    return out
  }

  /** Search view: keep matching leaves AND their ancestor folders (IDEA's
   * filter keeps the path), hide non-matching siblings, force every kept
   * folder open, and highlight the hit substring. No chain compression —
   * the full ancestor path is exactly the context the search is for. */
  const renderSearch = (nodes: TreeNode[], depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (const node of nodes) {
      const leafHit = node.leaf !== null && node.leaf.name.toLowerCase().includes(needle)
      const childHit = subtreeMatches(node.children)
      if (leafHit) {
        out.push(
          <button
            key={node.path}
            type="button"
            role="menuitem"
            data-branch={node.path}
            className={rowClass(node.path)}
            disabled={node.leaf?.disabled ?? false}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => { if (guardActive()) return; rowClick(buttonOf(node.path), node.path) }}
            onDoubleClick={(event) => { if (guardActive()) return; pick(event.currentTarget, node.path) }}
            onMouseEnter={(event) => { gateTooltip(event.currentTarget, node.path) }}
            onMouseLeave={(event) => { clearTooltip(event.currentTarget) }}
          >
            <span className={css.menuRowLabel}>{renderLabel(node.segment)}</span>
            {node.path === currentBranch && <IconCheckOutline16 size={14} />}
          </button>,
        )
      }
      if (childHit) {
        out.push(
          <div
            key={`search:${node.path}`}
            role="presentation"
            className={css.menuGroup}
            data-group={node.path}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <IconChevronDownOutline14 size={12} className={css.menuGroupChevron} />
            <span className={css.menuGroupLabel}>{renderLabel(node.segment)}</span>
            <span className={css.menuGroupCount}>({node.total})</span>
          </div>,
        )
        out.push(...renderSearch(node.children, depth + 1))
      }
    }
    return out
  }

  /** The rendered button for a branch name (flyout anchor on click-select
   * paths, where the handler only has the name at hand). */
  const buttonOf = (name: string): HTMLButtonElement | null =>
    cardRef.current?.querySelector<HTMLButtonElement>(`button[data-branch="${CSS.escape(name)}"]`) ?? null

  return (
    <>
      {createPortal(
        <div
          ref={cardRef}
          className={css.menuCard}
          style={{ left: pos.left, bottom: pos.bottom }}
          role="menu"
          aria-label={t('menuLocalBranches')}
        >
          <div className={css.menuToolbar} role="toolbar" aria-label={t('menuLocalBranches')}>
            <button
              type="button"
              className={creating ? `${css.menuToolButton} ${css.menuToolButtonOn}` : css.menuToolButton}
              title={t('menuNewBranch')}
              aria-label={t('menuNewBranch')}
              aria-pressed={creating}
              disabled={!canCreate}
              onClick={() => {
                // Opening the flyout cancels a staged confirm first: the
                // flyout would otherwise stay anchored to a stale row beside
                // the create panel. Closing drops the draft with it.
                confirmRef.current?.onCancel()
                const next = !creating
                setCreating(next)
                if (!next) setDraft('')
              }}
            >
              <IconPlusOutline16 size={16} />
            </button>
            <button
              type="button"
              className={css.menuToolButton}
              title={t('menuLocate')}
              aria-label={t('menuLocate')}
              onClick={locateCurrent}
            >
              <IconGoalOutline16 size={16} />
            </button>
            <button
              type="button"
              className={css.menuToolButton}
              title={allExpanded ? t('menuCollapseAll') : t('menuExpandAll')}
              aria-label={allExpanded ? t('menuCollapseAll') : t('menuExpandAll')}
              disabled={folderPaths.length === 0}
              onClick={toggleAll}
            >
              {allExpanded ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
            </button>
            <button
              type="button"
              className={css.menuToolButton}
              title={t('menuFetch')}
              aria-label={t('menuFetch')}
              disabled={fetchBusy}
              onClick={() => {
                // A staged confirm must not ride out the sync: while the
                // fetch runs, busy would flip its labels into progress text
                // for an action nobody is running.
                confirmRef.current?.onCancel()
                onFetch()
              }}
            >
              <IconRefreshOutline16 size={16} />
            </button>
          </div>
          <div className={css.menuMain}>
            <div className={css.menuHeading}>{t('menuLocalBranches')}</div>
            <div className={css.menuRows} role="presentation" ref={holdRowsCenter}>
              {needle === '' ? renderTree(tree, 0) : renderSearch(tree, 0)}
              {visible.length === 0 && <div className={css.menuEmpty}>{t('menuNoMatches')}</div>}
            </div>
            <div className={css.menuSearchWrap}>
              <input
                ref={holdSearchFocus}
                className={css.menuSearch}
                type="text"
                value={query}
                placeholder={t('menuSearchPlaceholder')}
                aria-label={t('menuSearchPlaceholder')}
                spellCheck={false}
                onChange={event => { setQuery(event.target.value) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitFirst()
                  }
                }}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
      {confirm !== null && createPortal(
        <div
          ref={flyRef}
          className={css.popCard}
          style={flyPos ?? FLY_MEASURE}
          role="dialog"
          aria-label={confirm.ask}
        >
          <p className={css.popAsk}>{confirm.ask}</p>
          <div className={css.popActions}>
            <button type="button" disabled={confirm.busy} onClick={confirm.onCancel}>
              {confirm.cancelLabel}
            </button>
            <button ref={flyConfirmRef} type="button" disabled={confirm.busy} onClick={confirm.onConfirm}>
              {confirm.confirmLabel}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {creating && createPortal(
        <div
          ref={createFlyRef}
          className={css.popCard}
          style={createFlyPos ?? FLY_MEASURE}
          role="dialog"
          aria-label={t('createBranchTitle', { branch: currentBranch })}
        >
          <p className={css.popAsk}>{t('createBranchTitle', { branch: currentBranch })}</p>
          <input
            ref={holdCreateFocus}
            className={css.menuCreate}
            type="text"
            value={draft}
            placeholder={t('menuNewBranchPlaceholder')}
            aria-label={t('menuNewBranchPlaceholder')}
            aria-invalid={createIssue !== null && createIssue !== 'empty'}
            spellCheck={false}
            disabled={busy}
            onChange={event => { setDraft(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitCreate()
              }
            }}
          />
          {showCreateHint && (
            <p className={css.menuCreateHintBad} role="status">{createHint}</p>
          )}
          <div className={css.popActions}>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setCreating(false); setDraft('') }}
            >
              {t('actionCancel')}
            </button>
            <button type="button" disabled={!createValid || busy} onClick={commitCreate}>
              {busy ? t('createBranchBusy') : t('actionConfirm')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}