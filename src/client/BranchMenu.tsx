/**
 * BranchMenu: the branch picker popup anchored to the composer branch chip.
 * The base Menu primitive exposes neither a height cap nor a search field,
 * so with many branches its portal list fills the viewport — this popup
 * replaces it with an owner-styled card: Menu's card chrome (r12, inverted
 * hairline, shadow-lv3, --dsw-specific-menu, see .menuCard) on a
 * portal-fixed posture, with three owner requirements baked in:
 *
 *   1. the card is capped at min(420px, 60vh) and only the branch rows
 *      scroll (heading and search stay pinned);
 *   2. a search field is pinned at the card's bottom edge — the row list
 *      scrolls above it — filtering rows by case-insensitive substring;
 *   3. the card opens entirely above the chip: the CSS `bottom` pins its
 *      bottom edge ~6px above the chip's top, so it grows upward and can
 *      never cover the composer, whatever the branch count.
 *
 * The confirm step is a second-level flyout opening to the RIGHT of the
 * branch card (the base Menu's submenu posture): the chip sits in the
 * bottom composer, so the old below-the-chip bubble landed off-viewport.
 * The flyout is a separate portal (not clipped by the card's
 * overflow:hidden), horizontally anchored to the card's right edge — it
 * can never overlap the branch list — and vertically centered on the
 * picked row. Its width is content-driven (it follows the branch name in
 * the ask line), capped in CSS, wrapping beyond the cap. Picking a
 * different row while the flyout is open re-anchors it beside that row.
 *
 * Close semantics: outside pointerdown (card, flyout, and chip excluded)
 * cancels the confirm and closes the menu; Escape cancels tier by tier —
 * first the confirm, then the menu; Enter in the search field commits the
 * first enabled visible row.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
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
  /** The branch currently checked out (trailing check, re-select closes). */
  currentBranch: string
  /** Non-null while a picked branch awaits confirmation. */
  confirm: BranchConfirmFly | null
  /** Row click / Enter-in-search commit (current branch re-select closes). */
  onSelect: (branch: string) => void
  /** Dismiss the menu (outside click, Escape with no confirm open). */
  onClose: () => void
  /** Bound locale translate (placeholder, empty state, heading). */
  t: PropsLocale<'git-worktree'>['t']
}

/** Viewport edge clearance, mirroring the base Menu portal margin. */
const MARGIN = 12
/** Gap kept between the chip's top edge and the card's bottom edge. */
const GAP = 6
/** Design card width — the CSS width's px arm; used for horizontal clamping. */
const CARD_WIDTH = 320
/** Design flyout width cap — matches .popCard's max-width arm. */
const FLY_MAX_WIDTH = 400
/** Unplaced flyout: hidden but laid out at a fixed origin so offsetWidth/
 * offsetHeight are real for the measure-then-place pass (base Menu trick). */
const FLY_MEASURE: Partial<CSSStyleDeclaration> = { left: '-9999px', top: '0px', visibility: 'hidden' }

/**
 * Render the upward branch picker with its right-side confirm flyout.
 * @param props - anchor, rows, confirm bundle, callbacks, and the class sheet.
 * @returns null while closed or unplaced; otherwise the portaled card (+flyout).
 */
export function BranchMenu({
  open, anchorRef, rows, currentBranch, confirm, onSelect, onClose, t,
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
  const holdSearchFocus = (el: HTMLInputElement | null): void => {
    inputRef.current = el
    if (el !== null) el.focus()
  }
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

  // Latest confirm bundle for stable-effect listeners (the parent rebuilds
  // the object each render; the ref keeps handler deps from churning).
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  const confirmOpen = confirm !== null

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

  // Every open starts from a clean filter (focus rides the input's mount
  // via holdSearchFocus — see there for why not here).
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  // Land the current-branch row mid-viewport on open and whenever the
  // filter clears back to the full list — with dozens of branches the row
  // otherwise drowns somewhere off-screen and "where am I?" becomes a
  // scroll hunt (the trailing check alone is invisible from afar; the
  // .menuRowSelected tint marks it once visible). Manual scrollTo on the
  // rows container — scrollIntoView would also drag scrollable ancestors.
  useEffect(() => {
    if (!open || query.trim() !== '') return
    const card = cardRef.current
    if (card === null) return
    const row = [...card.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .find(b => (b.textContent ?? '').trim() === currentBranch)
    // The row's parent is .menuRows — the only scroll container involved.
    const viewport = row?.parentElement
    if (row === undefined || viewport === null) return
    const rowRect = row.getBoundingClientRect()
    const vpRect = viewport.getBoundingClientRect()
    const target = viewport.scrollTop + (rowRect.top - vpRect.top) - (viewport.clientHeight - rowRect.height) / 2
    viewport.scrollTo({ top: Math.max(0, target) })
  }, [open, currentBranch, query])

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

  // Outside pointer / Escape dismiss. Outside clicks cancel the confirm and
  // close the menu in one go; Escape unwinds tier by tier (confirm first,
  // menu second) like closing a submenu before its parent.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (cardRef.current?.contains(event.target as Node) === true) return
      if (flyRef.current?.contains(event.target as Node) === true) return
      if (anchorRef.current?.contains(event.target as Node) === true) return
      confirmRef.current?.onCancel()
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (confirmRef.current !== null) confirmRef.current.onCancel()
      else onClose()
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

  /** Stage a pick: remember the row element (the flyout anchors beside
   * it), then hand the branch to the owner. Both entry paths — row click
   * and Enter-in-search — funnel through here so the flyout always has a
   * live anchor. */
  const pick = (el: HTMLElement | null, name: string): void => {
    if (el !== null) pendingRef.current = { name, el }
    setPendingName(name)
    onSelect(name)
  }

  /** Enter in the search field: commit the first enabled visible row
   * (its rendered button is the anchor — found by exact name match). */
  const commitFirst = (): void => {
    const first = visible.find(row => !row.disabled)
    if (first === undefined) return
    const buttons = cardRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []
    const el = [...buttons].find(b => (b.textContent ?? '').trim() === first.name) ?? null
    pick(el, first.name)
  }

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
          <div className={css.menuHeading}>{t('menuLocalBranches')}</div>
          <div className={css.menuRows} role="presentation">
            {visible.map(row => (
              <button
                key={row.name}
                type="button"
                role="menuitem"
                className={row.name === currentBranch ? `${css.menuRow} ${css.menuRowSelected}` : css.menuRow}
                disabled={row.disabled}
                onClick={(event) => { pick(event.currentTarget, row.name) }}
              >
                <span className={css.menuRowLabel}>{row.name}</span>
                {row.name === currentBranch && <IconCheckOutline16 size={14} />}
              </button>
            ))}
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
    </>
  )
}
