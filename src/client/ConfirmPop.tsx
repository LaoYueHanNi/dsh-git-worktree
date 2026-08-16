/**
 * ConfirmPop: a small anchored confirmation bubble — the same portal-fixed
 * posture as the branch Menu (below the chip, Menu's card chrome: r12,
 * inverted hairline, shadow-lv3, --dsw-specific-menu), carrying one ask line
 * and a compact Cancel/Confirm pair. Replaces the centered modal so the
 * confirm step reads as the menu's second page rather than an app dialog.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmPopProps {
  /** Whether the bubble shows. */
  open: boolean
  /** The anchor element — the bubble positions below it, clamped to the viewport. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Ask line (already localized). */
  ask: string
  /** Confirm-button label. */
  confirmLabel: string
  /** Cancel-button label. */
  cancelLabel: string
  /** True while the action runs: both buttons disable, the label shows progress. */
  busy: boolean
  /** Run the confirmed action. */
  onConfirm: () => void
  /** Dismiss without acting (outside click, Escape, Cancel). */
  onCancel: () => void
  /** Sheet styles: the card, ask line, and button row (from the caller's CSS module). */
  classes: { card: string; ask: string; actions: string }
}

/**
 * Render the anchored confirmation bubble.
 * @param props - anchor, copy, state, and the class sheet.
 * @returns null while closed; otherwise the portaled bubble.
 */
export function ConfirmPop({
  open, anchorRef, ask, confirmLabel, cancelLabel, busy, onConfirm, onCancel, classes,
}: ConfirmPopProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measure on open and on viewport movement while open (Menu's posture).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = (): void => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const rect = anchor.getBoundingClientRect()
      setPos({ left: rect.left, top: rect.bottom + 6 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef])

  // Outside pointer / Escape dismiss (Menu's close semantics).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (cardRef.current?.contains(event.target as Node) === true) return
      if (anchorRef.current?.contains(event.target as Node) === true) return
      onCancel()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onCancel, anchorRef])

  if (!open || pos === null) return null

  const card: ReactNode = (
    <div
      ref={cardRef}
      className={classes.card}
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={ask}
    >
      <p className={classes.ask}>{ask}</p>
      <div className={classes.actions}>
        <button type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" disabled={busy} onClick={onConfirm}>{busy ? confirmLabel : confirmLabel}</button>
      </div>
    </div>
  )

  return createPortal(card, document.body)
}
