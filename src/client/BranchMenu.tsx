/**
 * BranchMenu: the branch picker popup anchored to the composer branch chip.
 * The base Menu primitive exposes neither a height cap nor a search field,
 * so with many branches its portal list fills the viewport — this popup
 * replaces it with an owner-styled card: Menu's card chrome (r20,
 * elevation-prominent hairline, --dsw-specific-menu, see .menuCard;
 * hosts without the token fall back to shadow-lv3) on a
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
 * main column of heading / tree / search. The list renders in TWO
 * top-level collapsible groups — local branches first, then remote
 * branches (each a folder-header-style row with chevron + count): under a
 * SINGLE remote the remote rows drop their `<remote>/` prefix (the header
 * already says "remote"; a stripped display name can never collide with a
 * local row because the host hides remote branches that have a local
 * twin), with SEVERAL remotes the full names stay so `origin`/`upstream`
 * become the folder layer beneath the header. Picking a remote row hands
 * the owner the real `<remote>/name` (see pick) — 签出 dwims the tracking
 * twin in place, and the worktree verbs spell the twin-in-worktree ask.
 * Selection model: a single click SELECTS a row (blue); Enter or the row's
 * RIGHT-CLICK menu executes — 签出 and the worktree hop run DIRECTLY (no
 * confirmation step; the switch is keep-open, the hop moves the session),
 * while the consequential verbs keep their dialogs (delete's confirm, the
 * create/rename inputs). While a dialog is open, clicking another row
 * re-anchors it (the old one-click pick flow).
 *
 * Rows also speak right-click: a cursor-anchored context menu (the browser's
 * native one is suppressed over rows only). A branch row gets the six-verb
 * set — 签出 (through `pick`, executed DIRECTLY — no confirmation step),
 * 新建 and 新建并检出
 * (the create flyout with the row as the `from` start point, the latter
 * adding `checkout` so `git switch -c <name> <from>`), 重命名分支 and
 * 删除分支 (local rows; a rename flyout prefilled with the current name /
 * the safe-delete confirm), 复制分支 — with each verb degenerating where it
 * has no object (current branch: no 签出, no 删除; canCreate gates the
 * write trio; remote rows: no rename, no delete). A worktree row keeps its
 * launcher set (hop + copy path + remove worktree). The menu is a second
 * surface, never
 * a second semantics — it IS the execution channel (the double-click it
 * replaced is gone), alongside Enter for the keyboard.
 *
 * The create and rename flyouts open IN PLACE of the row menu — at the
 * very point it stood (staged-from-menu posture; the cursor never leaves
 * the conversation), clamped into the viewport. Each holds its input —
 * validated as you type (git ref-name rules plus a duplicate check against
 * the rows; the rename pre-fills the current name and disables an
 * unchanged draft) — and the Cancel/confirm pair. Confirming fires in ONE
 * stroke (no second confirm step — typing into the flyout and pressing the
 * button IS the intent). While the action runs the flyout freezes (busy
 * disables input and buttons); a failure toasts and leaves the flyout open
 * for a corrected retry, a success closes the flyout but KEEPS THE MENU
 * OPEN (the row-menu keep-open rule: 原地动作 — checkout, create, rename,
 * delete — leave the picker up for more rows; only session-hopping actions
 * close it). A confirm flyout staged WITHOUT the row menu (worktree picks
 * from Enter or a re-click) anchors to the card's right edge as before.
 * The flyouts are separate portals (not clipped by the card's
 * overflow:hidden); their width is content-driven, capped in CSS, wrapping.
 *
 * Every row is actionable, by construction: the owner never sends a branch
 * this directory cannot act on (a linked-worktree session gets its own
 * branch plus the OTHER worktrees — never another branch, see the chip's
 * `rows`), so there is no dimmed/locked state, no verb withheld per-row for
 * that reason, and nothing for the search field's Enter commit to skip.
 *
 * Close semantics: outside pointerdown (card, flyouts, row menu, and chip
 * excluded) cancels the confirm and closes the menu; Escape unwinds tier
 * by tier — row menu, confirm, create flyout, rename flyout, search text,
 * selection, the menu; Enter in the search field commits the first enabled
 * visible row.
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCopyOutlineRegular,
  IconEditOutlineRegular,
  IconGoalOutlineRegular,
  IconPlusOutlineRegular,
  IconProjectAddOutlineRegular,
  IconRightUpOutlineRegular,
  IconTrashOutlineRegular,
  Toast,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { branchNameIssue } from '../normalize.ts'
import {
  buildTree, chainExpanded, collectFolderPaths, groupKey, groupRows,
  type BranchRow, type TreeNode,
} from './branch-tree.ts'
import { dispatchBranchMenuKeyDown } from './branch-keyboard.ts'
import css from './BranchChip.module.css'

// The row type travels with the component for every caller (BranchChip
// imports both from here): the split is an implementation detail of where
// the tree logic can be tested, not a new module boundary for consumers.
export type { BranchRow }

/** The confirm flyout bundle, owned and localized by the caller. */
export interface BranchConfirmFly {
  /** Ask line (already localized). */
  ask: string
  /** The branch the ask refers to, on its own weight-500 line (remote
   * picks only — the ask line says "该远程分支" and this names it). */
  subject?: string
  /** Consequence lines under the ask (the worktree removal's dirty/ahead/
   * archived-sessions facts), each on its own subdued row — the ask states
   * the action, the details state its price. */
  details?: React.ReactNode
  /** Confirm-button label (progress text while busy). */
  confirmLabel: string
  /** Cancel-button label. */
  cancelLabel: string
  /** True while the action runs: both buttons disable. */
  busy: boolean
  /** Editable draft (the cutout flow's new-branch name): present, the
   * flyout renders a naming input under the ask line and focuses IT —
   * typing IS the point, Enter commits a valid draft. */
  draft?: string
  /** Draft change verb (presence marks the input on, with `draft`). */
  onDraftChange?: (value: string) => void
  /** Input placeholder (the shared new-branch-name copy). */
  draftPlaceholder?: string
  /** True while the draft is NOT an acceptable new branch name — the
   * confirm button disables in lockstep. */
  draftInvalid?: boolean
  /** Why the draft is invalid (rendered under the input; absent while the
   * draft is acceptable or merely empty). */
  draftHint?: string
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
  /** Every branch as a row (local, remote, and one worktree row per live
   * linked worktree; remote rows carry their `<remote>/name` action name). */
  rows: readonly BranchRow[]
  /** Whether the worktree group is offered. The owner answers this: the
   * group shows on the main checkout's BLANK session and on every linked-
   * worktree session (hopping between worktrees is what they are for, and
   * a hop opens a fresh session without moving any checkout); a STARTED
   * main-checkout session keeps it off. With it off the group is not
   * rendered at all, so its rows leave every derived set too (see
   * `pickableWorktreeRows`). */
  canAdopt: boolean
  /** The branch currently checked out (trailing check, HEAD tint). */
  currentBranch: string
  /** Non-null while a picked branch awaits confirmation. */
  confirm: BranchConfirmFly | null
  /** Stage a pick (starts the confirm flyout beside that row). Current
   * branch re-select closes the menu unless the owner stages otherwise. */
  onSelect: (branch: string) => void
  /** Whether row-level branch WRITING is offered (context menu's create /
   * rename / delete): worktree mode routes creation through the cutout flow
   * and a linked-worktree session acts from the main checkout — both gate
   * the trio off (the old toolbar plus is gone; this gate survived it). */
  canCreate: boolean
  /** Whether the WORKTREE verbs are offered (创建工作树 / 新建分支并创建
   * 工作树): only while the session is BLANK of the main checkout — a
   * started session's directory is fixed, so isolating a new worktree from
   * here is meaningless. A SEPARATE gate from `canAdopt`: these verbs
   * CREATE a worktree and belong to the main checkout's blank moment, while
   * the hop group is a read-and-jump surface that linked-worktree sessions
   * also get. The old toggle that used to arm a mode bit is gone — the
   * verbs are explicit menu items now. */
  canWorktree: boolean
  /** Stage the worktree CONFIRM (the reuse/new/remote-twin ask) for a
   * RIGHT-CLICKED branch: the row menu knows the row element (the dialog
   * anchors at the menu's point), the owner knows the rows (a remote row
   * carries the twin wording). Deliberately NOT routed through `onSelect` —
   * that path is the plain in-place 签出. */
  onWorktree: (branch: string) => void
  /** Stage the cutout dialog for a RIGHT-CLICKED base branch: the editable
   * new-branch name starts empty and is typed by hand; the base is that
   * row's branch (any row, current checkout included). */
  onCutWorktree: (base: string) => void
  /** Stage the worktree REMOVAL confirm for a RIGHT-CLICKED worktree row:
   * the menu hands over the directory and its branch, the owner runs the
   * shared removal flow (git first, archives and unregistration after — the
   * branch itself survives). Offered wherever the worktree group is (the
   * hop's surfaces): a removal launched from inside a worktree session
   * always targets some OTHER worktree — the session's own never renders. */
  onRemoveWorktree: (path: string, branch: string) => void
  /** True when the worktree directory holds a RUNNING session — its removal
   * item renders disabled with the reason on hover (the manager dialog's
   * withhold rule, same cause). */
  worktreeRemovalBlocked: (path: string) => boolean
  /** Run the create NOW. Entry shapes share one flyout: a row context
   * menu's 新建 cuts from THAT branch leaving every checkout untouched
   * (`from` set), 新建并检出 checks it out here in one stroke (`from` +
   * `checkout`), and the removed toolbar plus used to cut from the current
   * checkout in place (`from` absent — kept for API shape). The flyout's
   * Create button fires this once for a valid draft — no second confirm
   * step. `onSettled` runs on SUCCESS only: the menu stays open (the
   * keep-open rule), so the flyout closes itself through this hook; a
   * failure skips it and the flyout stays for a renamed retry. */
  onCreate: (name: string, from: string | undefined, checkout: boolean, onSettled: () => void) => void
  /** Rename a LOCAL branch (`git branch -m`, repository-wide). Fired by the
   * rename flyout's confirm button for a valid changed draft; `onSettled`
   * follows the create's success-only contract. */
  onRename: (name: string, newName: string, onSettled: () => void) => void
  /** Delete a LOCAL branch (`git branch -d`, safe form — git refuses
   * unmerged commits and occupied branches). Fired by the row menu's
   * 删除分支 after the confirm flyout; success keeps the menu open and the
   * refreshed rows drop the row. */
  onDelete: (branch: string) => void
  /** True while the create runs: the flyout freezes (input and buttons
   * disable, the Create button shows progress text). */
  busy: boolean
  /** Sync remote-tracking refs (fetch every remote + prune); the owner
   * refreshes the rows when it lands — the menu stays open. */
  onFetch: () => void
  /** True while the remote sync runs: the fetch tool spins and the update
   * tool disables (single-flight). */
  fetchBusy: boolean
  /** Update the CURRENT branch: fetch + fast-forward it to its upstream;
   * the owner refreshes the rows when it lands. */
  onUpdate: () => void
  /** True while the update runs: the update tool spins and the fetch tool
   * disables (single-flight). */
  updateBusy: boolean
  /** Dismiss the menu (outside click, Escape with nothing open). */
  onClose: () => void
  /** Bound locale translate (placeholder, empty state, heading, toolbar). */
  t: PropsLocale<'git-worktree'>['t']
}

/**
 * The fetch/update glyph in IDEA's posture: a diagonal running from the
 * top-right down to a bottom-left arrowhead. `dashed` marks the metadata
 * move (fetch touches remote-tracking refs only, never working-tree
 * content); the solid variant is the in-place branch update (fetch +
 * fast-forward) — the pairing is IDEA's dashed/solid synchronize/update
 * language. The base library has no such glyph, so both are drawn here,
 * local to the menu; the sync spin animation targets `svg` descendants of
 * the tool button and applies to them unchanged.
 */
function FetchGlyph({ size = 16, dashed = true }: { size?: number; dashed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 3 L5.9 10.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeDasharray={dashed ? '2.4 1.6' : undefined}
      />
      <path
        d="M5 5.9 V11 H10.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
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
 * (layout-shift guard — see shiftGuardUntil in the component). */
const CLICK_GUARD_MS = 250
/** Unplaced flyout: hidden but laid out at a fixed origin so offsetWidth/
 * offsetHeight are real for the measure-then-place pass (base Menu trick). */
const FLY_MEASURE: CSSProperties = { left: '-9999px', top: '0px', visibility: 'hidden' }

/** Past this many rows the tree starts with ONLY the checked-out branch's
 * chain open; at or under it every folder starts open (few branches have
 * nothing to hide). The tree itself always renders — this threshold is
 * about the default opening depth, never about flat vs tree. */
const TREE_MIN_ROWS = 8

/** Leaf rows indent one chevron slot PAST their tree depth. Folder headers
 * lead with a collapsing chevron (12px icon + 6px gap) that leaf rows lack
 * — without compensation a leaf's text starts LEFT of its own group header's
 * text and same-level leaves read shallower than folders. The extra 18px
 * aligns same-level leaf TEXT with folder TEXT (the VS Code file-tree
 * posture: a chevron column marks foldable rows, a text column carries
 * content), so leaf padding is 8 + 12×depth + 18. */
const LEAF_CHEVRON_SLOT = 18

/**
 * Place one flyout of the picker's family (confirm / create / rename).
 *
 * All three share one posture, and it used to be written out three times:
 * **row-menu-staged** flyouts replace the menu AT its cursor point (the
 * pointer never leaves the conversation), everything else anchors to the
 * card's right edge — never over the branch list — vertically centered on
 * its own anchor and clamped into the viewport. The width is
 * content-driven through a measure-then-place pass: the flyout first lays
 * out hidden at FLY_MEASURE (real offsets, no flash), place() clamps its
 * inline max-width to the room right of the card, then pins the box.
 *
 * @param active - whether the flyout is showing; false clears the position.
 * @param flyRef - the flyout element being placed.
 * @param cardRef - the picker card it hangs off.
 * @param pointRef - the staged row-menu point, or null-valued for the card-side posture.
 * @param verticalAnchor - the box whose center the flyout rides; null centers on the card.
 * @param deps - extra re-place triggers (a re-pick moves the anchor row).
 * @returns the placed position, or null while unmeasured.
 */
function useFlyoutPlacement(
  active: boolean,
  flyRef: React.RefObject<HTMLDivElement | null>,
  cardRef: React.RefObject<HTMLDivElement | null>,
  pointRef: React.RefObject<{ x: number; y: number } | null>,
  verticalAnchor: (() => DOMRect | null) | null,
  deps: readonly unknown[],
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!active) {
      setPos(null)
      return
    }
    const place = (): void => {
      const fly = flyRef.current
      if (fly === null) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const fw = fly.offsetWidth
      const fh = fly.offsetHeight
      const point = pointRef.current
      if (point !== null) {
        setPos({
          left: Math.min(Math.max(point.x, MARGIN), Math.max(MARGIN, vw - MARGIN - fw)),
          top: Math.min(Math.max(point.y, MARGIN), Math.max(MARGIN, vh - MARGIN - fh)),
        })
        return
      }
      const card = cardRef.current
      if (card === null) return
      const cr = card.getBoundingClientRect()
      const anchor = verticalAnchor === null ? cr : verticalAnchor()
      if (anchor === null) return
      const left = cr.right + GAP
      // Fit the right side: content width first, clamped by the room left
      // of the viewport margin (the 200px floor keeps the buttons usable
      // on very narrow windows, at the cost of spilling past the margin).
      const room = Math.min(FLY_MAX_WIDTH, Math.max(200, vw - MARGIN - left))
      fly.style.maxWidth = `${room}px`
      const top = Math.min(
        Math.max(anchor.top + anchor.height / 2 - fh / 2, MARGIN),
        Math.max(MARGIN, vh - fh - MARGIN),
      )
      setPos({ left: Math.min(left, vw - MARGIN - fw), top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // Refs are stable by construction and deliberately absent here;
    // `deps` carries whatever else moves the anchor (a mid-open re-pick).
    // Each call site passes a fixed-length `deps`, so the array length
    // never changes across renders.
  }, [active, verticalAnchor, ...deps])
  return pos
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
  open, anchorRef, rows, currentBranch, confirm, onSelect, canCreate, canAdopt, canWorktree, onWorktree, onCutWorktree, onRemoveWorktree, worktreeRemovalBlocked, onCreate, onRename, onDelete, busy, onFetch, fetchBusy, onUpdate, updateBusy, onClose, t,
}: BranchMenuProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
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
  /** The create/rename flyout inputs. Focus does NOT ride the ref callback:
   * the flyout's first frame lays out in the hidden measure-then-place
   * posture, and focus() on a visibility:hidden element is a no-op (the
   * confirm button hit the same wall — see its rAF effect) — so the refs
   * are plain holders and the focus effect below lands one frame later,
   * once the placed flyout is visible. */
  const createInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const flyRef = useRef<HTMLDivElement>(null)
  const flyConfirmRef = useRef<HTMLButtonElement | null>(null)
  /** The cutout draft input inside the confirm flyout (present only when
   * the owner staged a draft — see BranchConfirmFly). */
  const flyInputRef = useRef<HTMLInputElement | null>(null)
  /** The row whose pick is awaiting confirmation (anchoring element). */
  const pendingRef = useRef<{ name: string; el: HTMLElement } | null>(null)
  /** Pending row's name — the placement-effect trigger: picking another
   * row while the flyout is open must re-anchor it (confirmOpen alone
   * stays true, so a ref mutation re-renders nothing). */
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const [query, setQuery] = useState('')
  /** Expanded folder set, keyed by group-prefixed node path (see groupKey).
   * Re-seeded on every open so the current branch's chain is visible
   * without re-expanding by hand. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  /** Top-level group open flags, beside the expanded set (which owns
   * folder paths only — a group header is not a path node). Re-seeded on
   * every open: past TREE_MIN_ROWS the remote group starts closed so the
   * list leads with the local branches. The WORKTREE group starts open
   * unconditionally — it is the blank session's quick-hop entry, always
   * worth its few rows. */
  const [localGroupOpen, setLocalGroupOpen] = useState(true)
  const [remoteGroupOpen, setRemoteGroupOpen] = useState(true)
  const [worktreeGroupOpen, setWorktreeGroupOpen] = useState(true)
  /** IDEA-style selection: clicked row (blue). Zero or one at a time. */
  const [selected, setSelected] = useState<string | null>(null)
  /** The create flyout: open flag plus the live draft. Opening the menu
   * (or closing the flyout) resets both — see the open-reset effect. */
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  /** The create's start point: the row context menu's cut base (新建/新建
   * 并检出 always stage it with the row's branch — the toolbar plus that
   * used to leave it undefined is gone, the undefined shape survives only
   * in the owner API). `createCheckout` splits the two from-shapes: with
   * the base AND checked out here (新建并检出), or at the base with no
   * checkout touched (新建). Reset on every open. */
  const [createBase, setCreateBase] = useState<string | undefined>(undefined)
  const [createCheckout, setCreateCheckout] = useState(false)
  /** The rename flyout: the LOCAL branch being renamed plus the live draft
   * (pre-filled with the current name — an unchanged draft disables the
   * confirm). Opened only from a row context menu; reset on menu open. */
  const [renaming, setRenaming] = useState<{ name: string; draft: string } | null>(null)
  const renameFlyRef = useRef<HTMLDivElement | null>(null)
  /** The create flyout element (placed by useFlyoutPlacement below, the
   * same measure-then-place posture as the confirm and rename flyouts). */
  const createFlyRef = useRef<HTMLDivElement | null>(null)
  /** The row context menu (right-click): the target row plus the cursor
   * point in viewport coordinates; null while closed. Placement is
   * computed once at open — a cursor-anchored transient does not track
   * scroll/resize (the next pointerdown, scrollbar drags included,
   * dismisses it). */
  const [ctx, setCtx] = useState<{ row: BranchRow | null; name: string; x: number; y: number } | null>(null)
  const ctxCardRef = useRef<HTMLDivElement | null>(null)
  const [ctxPos, setCtxPos] = useState<{ left: number; top: number } | null>(null)
  /** Where the row menu stood when one of its items staged a second-level
   * flyout (create/rename/delete confirm, a worktree-mode pick): the flyout
   * replaces the menu AT this point — the cursor is already here, so the
   * second click/keystroke should be too. Any non-ctx staging path (Enter,
   * click re-pick) clears it and the flyout falls back to the card-right
   * posture. Read by the three flyout placement passes. */
  const ctxPointRef = useRef<{ x: number; y: number } | null>(null)
  /** Copy feedback: a seq-keyed Toast (the shared copied label) fired by a
   * successful context-menu copy write. */
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null)

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
  /** Fresh rename flyout state for the same stale-safe listeners. */
  const renamingRef = useRef(renaming)
  renamingRef.current = renaming
  /** Fresh row-menu state for the same stale-safe listeners (Escape tier
   * and the outside-pointerdown dismissal). */
  const ctxStateRef = useRef(ctx)
  ctxStateRef.current = ctx
  /** Latest rows for the open-reset effect: the effect must NOT re-run when
   * a mid-open refresh swaps the rows (that would reset folders the user
   * has toggled), but the reset itself still needs the freshest list. */
  const latestRows = useRef(rows)
  latestRows.current = rows
  /** Latest checked-out branch for the open-reset effect. The reset must
   * fire on OPEN only: 签出 is keep-open, so the owner's refresh moves
   * `currentBranch` while the menu stands — keying the effect on it would
   * wipe the search text, the folder state, and any half-typed flyout
   * right after the switch the user meant to follow up on. The seeding
   * still needs the fresh value, hence the ref. */
  const currentBranchRef = useRef(currentBranch)
  currentBranchRef.current = currentBranch
  const canWorktreeRef = useRef(canWorktree)
  canWorktreeRef.current = canWorktree
  const onWorktreeRef = useRef(onWorktree)
  onWorktreeRef.current = onWorktree
  const onCutWorktreeRef = useRef(onCutWorktree)
  onCutWorktreeRef.current = onCutWorktree
  /** Always-fresh pick for the stale-safe document keydown listener. */
  const pickRef = useRef<(el: HTMLElement | null, name: string) => void>(() => {})
  const confirmOpen = confirm !== null

  /** The rendered button for a branch name (flyout anchor on click-select
   * paths, where the handler only has the name at hand). */
  const buttonOf = (name: string): HTMLButtonElement | null =>
    cardRef.current?.querySelector<HTMLButtonElement>(`button[data-branch="${CSS.escape(name)}"]`) ?? null

  /**
   * Layout-shift guard: toggling a folder shifts the layout — a rapid
   * second click can land on a row that slid under the cursor (a
   * branch!), which would select it or pop the switch flyout. After a
   * folder toggle, every click swallowed for CLICK_GUARD_MS, so a rushed
   * double-click on a folder expands it exactly once and never bleeds into
   * a branch click. Branch-row clicks do not arm the guard (selecting does
   * not move anything), so follow-up row clicks keep working instantly.
   */
  const shiftGuardUntil = useRef(0)
  const guardActive = (): boolean => Date.now() < shiftGuardUntil.current
  const armShiftGuard = (): void => { shiftGuardUntil.current = Date.now() + CLICK_GUARD_MS }

  /** Anchor a second-level flyout to a row: remember the row element (the
   * flyout anchors beside it) and mark it pending. Shared by every
   * right-side flyout stage path — pick (confirm) and the row menu's
   * delete (its own confirm). */
  const stagePending = (el: HTMLElement | null, name: string): void => {
    if (el !== null) pendingRef.current = { name, el }
    setPendingName(name)
  }

  /** Stage a pick: anchor the confirm flyout beside the row (or, when the
   * row menu staged it, AT the menu's point — see ctxPointRef), then hand
   * the branch to the owner. All pick paths — search Enter, keyboard Enter
   * on a selected row, the row menu's 签出 — funnel through here; only the
   * row menu's calls carry `fromCtx`. A remote row carries its DISPLAY name
   * through selection and anchors; the owner always receives the real
   * `<remote>/name` action name. */
  const pick = (el: HTMLElement | null, name: string, fromCtx = false): void => {
    if (!fromCtx) ctxPointRef.current = null
    stagePending(el, name)
    onSelect(remoteNameMapRef.current.get(name) ?? name)
  }
  pickRef.current = pick

  /** The two-group model of the rows (see groupRows) and each group's '/'
   * prefix tree — always on; TREE_MIN_ROWS only sets the default opening
   * depth (see the open-reset effect). */
  const grouped = useMemo(() => groupRows(rows), [rows])
  const localTree = useMemo(() => buildTree(grouped.localRows), [grouped.localRows])
  const remoteTree = useMemo(() => buildTree(grouped.remoteDisplayRows), [grouped.remoteDisplayRows])
  /** Fresh display→action map for the stale-safe document keydown listener
   * (its Enter path funnels through pick, which reads the ref). */
  const remoteNameMapRef = useRef(grouped.remoteNameMap)
  remoteNameMapRef.current = grouped.remoteNameMap
  /** The inverse map, action→display: state that holds an ACTION name (the
   * create flyout's base) has to read back as what the row showed, or a
   * single-remote setup would suddenly quote `origin/feat/x` at a user who
   * only ever saw `feat/x`. */
  const displayNameOf = useMemo(() => {
    const inverse = new Map([...grouped.remoteNameMap].map(([display, action]) => [action, display]))
    return (action: string): string => inverse.get(action) ?? action
  }, [grouped.remoteNameMap])

  /** Look up the row object for a branch name (local, remote display row, or worktree). */
  const findRow = (name: string): BranchRow | null => {
    const direct = latestRows.current.find(r => r.name === name)
    if (direct !== undefined) return direct
    const remote = grouped.remoteDisplayRows.find(r => r.name === name)
    if (remote !== undefined) return remote
    return null
  }

  /** Every folder key that renders a header — the expand/collapse-all
   * button's scope (group-prefixed, see groupKey). */
  const folderPaths = useMemo(() => [
    ...collectFolderPaths(localTree).map(p => groupKey('local', p)),
    ...collectFolderPaths(remoteTree).map(p => groupKey('remote', p)),
  ], [localTree, remoteTree])
  const allExpanded = folderPaths.every(p => expanded.has(p)) && localGroupOpen && remoteGroupOpen
    && (!canAdopt || worktreeGroupOpen)
  const toggleAll = (): void => {
    // The group headers join the toggle scope: one button opens (or
    // collapses) the whole tree, headers included.
    const next = !allExpanded
    setLocalGroupOpen(next)
    setRemoteGroupOpen(next)
    setWorktreeGroupOpen(next)
    setExpanded(next ? new Set(folderPaths) : new Set())
  }
  const locateCurrent = (): void => {
    // Locate, don't restructure: only ADD the current branch's ancestor
    // folders if they happen to be closed (the row must exist to scroll
    // to it) — folders the user expanded/collapsed stay untouched. The
    // LOCAL group opens too: the current branch ALWAYS lives there — a
    // worktree row never carries it (the main checkout is not a hop target,
    // and a linked-worktree session excludes its own worktree from the hop
    // group). Then center the row one frame later, once the re-render has
    // committed.
    setLocalGroupOpen(true)
    setExpanded(prev => {
      const next = new Set(prev)
      for (const p of chainExpanded(currentBranch)) next.add(groupKey('local', p))
      return next
    })
    requestAnimationFrame(() => {
      if (rowsRef.current !== null) centerCurrentRow(rowsRef.current)
    })
  }

  // Every open starts from a clean filter, selection, tree state, and
  // naming form. The tree's opening depth follows the list size: past
  // TREE_MIN_ROWS the local group (plus the checked-out branch's folder
  // chain) starts open while the remote group starts closed, at or under
  // it every group and folder does. Rows and the current branch both come
  // through refs — the effect keys on [open] ALONE so neither a mid-open
  // refresh nor a keep-open 签出 (which moves currentBranch) resets the
  // search text and the folders the user has toggled by hand.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(null)
    setCreating(false)
    setDraft('')
    setCreateBase(undefined)
    setCreateCheckout(false)
    setRenaming(null)
    setCtx(null)
    const currentRows = latestRows.current
    const current = groupRows(currentRows)
    const localPaths = collectFolderPaths(buildTree(current.localRows)).map(p => groupKey('local', p))
    const remotePaths = collectFolderPaths(buildTree(current.remoteDisplayRows)).map(p => groupKey('remote', p))
    const many = currentRows.length > TREE_MIN_ROWS
    setLocalGroupOpen(true)
    setRemoteGroupOpen(!many)
    setWorktreeGroupOpen(true)
    setExpanded(
      many
        ? new Set([...chainExpanded(currentBranchRef.current)].map(p => groupKey('local', p)))
        : new Set([...localPaths, ...remotePaths]),
    )
  }, [open])

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
      setCtx(null)
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

  // The three flyouts (confirm / create / rename) share one placement
  // posture — see useFlyoutPlacement. Only the vertical anchor differs:
  // the confirm centers on the PICKED ROW, the other two on the card.
  const flyPos = useFlyoutPlacement(
    confirmOpen && pendingName !== null, flyRef, cardRef, ctxPointRef,
    // The pending row's box, read at place() time (a mid-open re-pick
    // moves it). Keyed on pendingName below so a re-pick re-places.
    useCallback(() => pendingRef.current?.el.getBoundingClientRect() ?? null, []),
    [pendingName],
  )
  const createFlyPos = useFlyoutPlacement(creating, createFlyRef, cardRef, ctxPointRef, null, [])
  const renameFlyPos = useFlyoutPlacement(renaming !== null, renameFlyRef, cardRef, ctxPointRef, null, [renaming])

  // Row-menu placement: cursor-anchored, clamped into the viewport with one
  // measure-then-place pass (the FLY_MEASURE posture gives real offsets).
  // The menu deliberately does NOT re-place on scroll/resize the way the
  // card and the flyouts do — it is anchored to a cursor point, and a point
  // that has moved is no longer the point the user aimed at. It dismisses
  // instead: pointerdown already covered clicks, and scroll/resize cover
  // the rest (a wheel scroll fires no pointerdown, so the menu used to hang
  // at its old spot while the row it names slid out from under it).
  useLayoutEffect(() => {
    if (ctx === null) {
      setCtxPos(null)
      return
    }
    const el = ctxCardRef.current
    if (el === null) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    setCtxPos({
      left: Math.min(Math.max(ctx.x, MARGIN), Math.max(MARGIN, vw - MARGIN - el.offsetWidth)),
      top: Math.min(Math.max(ctx.y, MARGIN), Math.max(MARGIN, vh - MARGIN - el.offsetHeight)),
    })
    const dismiss = (): void => { setCtx(null) }
    window.addEventListener('resize', dismiss)
    // Capture phase: the list scrolls inside the card, and a scroll event
    // on an element does not bubble to window.
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [ctx])

  // The row menu is keyboard-reachable once open: focus the first item so
  // Arrow keys and Enter work without a pointer. The focus rides a rAF for
  // the same reason the flyouts' does — the first frame is the hidden
  // measure posture, and focus() on visibility:hidden is a no-op.
  useEffect(() => {
    if (ctx === null) return
    const raf = requestAnimationFrame(() => {
      ctxCardRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus()
    })
    return () => { cancelAnimationFrame(raf) }
  }, [ctx])

  // Confirm opens (or re-anchors to another row) → focus the DRAFT input
  // when the owner staged one (typing IS the point), else the confirm
  // button (Enter commits, Escape cancels); confirm closes → forget the
  // pending row anchor. The focus rides a rAF: the flyout mounts in the
  // hidden measure-then-place posture, and focus() on a visibility:hidden
  // element is a no-op — one frame later the placed card is visible and
  // the focus lands.
  useEffect(() => {
    if (confirmOpen && pendingName !== null) {
      const raf = requestAnimationFrame(() => {
        (flyInputRef.current ?? flyConfirmRef.current)?.focus()
      })
      return () => { cancelAnimationFrame(raf) }
    }
    if (!confirmOpen) {
      pendingRef.current = null
      setPendingName(null)
    }
  }, [confirmOpen, pendingName])

  // Create/rename flyout open → focus the input (typing IS the point —
  // the flyout should be ready for keystrokes the frame it appears). Same
  // rAF posture as the confirm button: the first frame is the hidden
  // measure-then-place layout, and focus() no-ops on visibility:hidden.
  // Keyed on the OPEN flags only — keystrokes mutate the rename draft (a
  // fresh object each change) and must not re-arm the effect.
  const renamingOpen = renaming !== null
  useEffect(() => {
    if (!creating && !renamingOpen) return
    const raf = requestAnimationFrame(() => {
      (creating ? createInputRef.current : renameInputRef.current)?.focus()
    })
    return () => { cancelAnimationFrame(raf) }
  }, [creating, renamingOpen])

  // Outside pointer / keyboard dismiss. Outside clicks cancel the confirm
  // and close the menu in one go. Escape unwinds tier by tier — confirm,
  // then search text, then selection, then the menu. Arrow keys move the
  // selection over the visible leaf rows and Enter stages the confirm,
  // but only while focus sits on a card button: the search input keeps
  // its own caret handling and Enter-commit.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      // The row menu unwinds first: a pointer outside it closes just the
      // menu, and only a pointer also outside the CARD falls through to
      // the whole-picker dismissal below (a click on another row must
      // keep the picker open).
      if (ctxStateRef.current !== null && ctxCardRef.current?.contains(event.target as Node) !== true) {
        setCtx(null)
        if (cardRef.current?.contains(event.target as Node) === true) return
      }
      // The row menu itself anchors the dismissal, exactly like the card
      // and the flyouts: it portals to document.body (OUTSIDE cardRef), so
      // without this check a click on a menu item reads as an outside
      // click, tears the whole picker down before the click ever lands,
      // and the item's action never runs. The rename flyout needs the same
      // anchor — without it its confirm button unmounts the picker on
      // pointerdown and the rename never fires.
      if (ctxCardRef.current?.contains(event.target as Node) === true) return
      if (renameFlyRef.current?.contains(event.target as Node) === true) return
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
        // The row menu is the topmost transient: it unwinds before the
        // confirm flyout, and one press takes only it.
        if (ctxStateRef.current !== null) {
          setCtx(null)
          if (selectedRef.current !== null) {
            requestAnimationFrame(() => {
              buttonOf(selectedRef.current ?? '')?.focus()
            })
          }
          return
        }
        if (confirmRef.current !== null) { confirmRef.current.onCancel(); return }
        if (creatingRef.current) { setCreating(false); setDraft(''); return }
        if (renamingRef.current !== null) { setRenaming(null); return }
        if (queryRef.current.trim() !== '') { setQuery(''); return }
        if (selectedRef.current !== null) { setSelected(null); return }
        onClose()
        return
      }
      const card = cardRef.current
      const active = document.activeElement
      if (card === null || active === null || !card.contains(active)) return
      if (ctxStateRef.current !== null) return

      const leaves = [...card.querySelectorAll<HTMLButtonElement>('button[role="menuitem"][data-branch]')]
      const isSearchInput = inputRef.current !== null && active === inputRef.current
      const leafNames = leaves.map(b => b.dataset.branch ?? '').filter(Boolean)

      dispatchBranchMenuKeyDown(
        {
          event,
          selected: selectedRef.current,
          currentBranch: currentBranchRef.current,
          canWorktree: canWorktreeRef.current,
          isSearchInput,
          leaves: leafNames,
          getElementRect: (branch) => {
            const el = leaves.find(b => (b.dataset.branch ?? '') === branch) ?? buttonOf(branch)
            return el?.getBoundingClientRect() ?? null
          },
        },
        {
          onOpenContextMenu: ({ name, x, y }) => {
            const row = findRow(name)
            setCtx({ row, name, x, y })
          },
          onWorktree: (branch) => {
            const el = buttonOf(branch)
            confirmRef.current?.onCancel()
            ctxPointRef.current = null
            setCtx(null)
            stagePending(el, branch)
            onWorktreeRef.current(branch)
          },
          onCutWorktree: (branch) => {
            const el = buttonOf(branch)
            confirmRef.current?.onCancel()
            ctxPointRef.current = null
            setCtx(null)
            stagePending(el, branch)
            onCutWorktreeRef.current(branch)
          },
          onPick: (branch) => {
            const el = leaves.find(b => (b.dataset.branch ?? '') === branch) ?? buttonOf(branch)
            pickRef.current(el, branch)
          },
          onSelect: (branch) => {
            setSelected(branch)
          },
          onFocusTarget: (index) => {
            const target = leaves[index]
            if (target !== undefined) {
              target.focus()
              target.scrollIntoView({ block: 'nearest' })
            }
          },
        },
      )
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onClose, anchorRef])

  if (!open || pos === null) return null

  const needle = query.trim().toLowerCase()
  /** The worktree rows that are actually OFFERED. Without `canAdopt` the
   * group is not rendered at all (a STARTED main-checkout session, see the
   * prop), so those rows must leave every derived set too — `visible` feeds
   * the search-Enter commit and the empty-state test, and a row that
   * reaches neither the eye nor the pointer must not be reachable by
   * keyboard either (an unrendered hit used to hop the session into a
   * worktree the gate had just withheld) nor count as "something matched"
   * under an empty list. */
  const pickableWorktreeRows = canAdopt ? grouped.worktreeRows : []
  // Search matches the DISPLAY names — what the rows actually show. With a
  // single remote that is the prefix-stripped form (searching "origin" no
  // longer matches; the user searches what they see), with several remotes
  // the full name.
  const visible = needle === ''
    ? (canAdopt ? rows : rows.filter(row => row.kind !== 'worktree'))
    : [...grouped.localRows, ...pickableWorktreeRows, ...grouped.remoteDisplayRows]
      .filter(row => row.name.toLowerCase().includes(needle))

  /** Enter in the search field: commit the first visible row (its rendered
   * button is the anchor — found by its data-branch key; the label text
   * alone can't identify a row inside a tree). */
  const commitFirst = (): void => {
    const first = visible[0]
    if (first === undefined) return
    const card = cardRef.current
    if (card === null) return
    const el = card.querySelector<HTMLButtonElement>(`button[data-branch="${CSS.escape(first.name)}"]`)
    pick(el, first.name)
  }

  /** New-branch draft validation: git ref-name rules first, then a duplicate
   * check against every EXISTING local branch — local rows and worktree
   * rows alike (a worktree row IS a checked-out branch, just filed under
   * its own group). A remote display name is not a claim on a new local
   * branch's name (its twin could not even coexist with one; the host
   * hides such remote rows). */
  const createIssue = branchNameIssue(draft)
  const existsLocally = (name: string): boolean =>
    grouped.localRows.some(row => row.name === name) || grouped.worktreeRows.some(row => row.name === name)
  const createDuplicate = createIssue === null && existsLocally(draft)
  const createValid = createIssue === null && !createDuplicate
  /** Error line under the input, ONLY while the draft is unacceptable with
   * a non-empty reason (the ask line above already names the cut point, and
   * an untouched input needs no error) — the Create button disables in
   * lockstep. */
  const createHint = createDuplicate ? t('menuNewBranchExists') : t('menuNewBranchBad')
  const showCreateHint = (createIssue !== null && createIssue !== 'empty') || createDuplicate

  /** Fire the create in one stroke — the flyout's whole point. Invalid
   * drafts and a running create are no-ops (the Create button disables in
   * lockstep); a failure toasts and leaves the flyout open for a renamed
   * retry, a success runs `onSettled` (flyout closes, the MENU stays —
   * the keep-open rule) via the owner. The start point rides along:
   * the row's branch as `from`, `checkout` splitting 新建 (at-base,
   * untouched checkouts) from 新建并检出 (at-base AND checked out here). */
  const commitCreate = (): void => {
    if (!createValid || busy) return
    onCreate(draft, createBase, createCheckout, () => {
      setCreating(false)
      setDraft('')
      setCreateBase(undefined)
      setCreateCheckout(false)
    })
  }

  /** Rename-draft validation: git ref-name rules first, then a duplicate
   * check against every EXISTING local name — the branch's own current name
   * excluded (a rename onto itself is the no-op the confirm disables via
   * `renameChanged`). Same namespace as the create: worktree-held names are
   * taken (their branches exist), remote names are no claim. */
  const renameIssue = renaming === null ? null : branchNameIssue(renaming.draft)
  const renameDuplicate = renaming !== null && renameIssue === null
    && renaming.draft !== renaming.name && existsLocally(renaming.draft)
  const renameChanged = renaming !== null && renaming.draft !== renaming.name
  const renameValid = renameIssue === null && !renameDuplicate && renameChanged
  const showRenameHint = (renameIssue !== null && renameIssue !== 'empty') || renameDuplicate

  /** Fire the rename in one stroke — the create flyout's one-stroke intent
   * on a prefilled input: editing the name and pressing confirm IS the
   * intent. Git stays the authority (an occupied target toasts 400 and the
   * flyout stays open for a corrected retry); success runs `onSettled` —
   * the flyout closes, the menu stays. */
  const commitRename = (): void => {
    if (renaming === null || !renameValid || busy) return
    onRename(renaming.name, renaming.draft, () => { setRenaming(null) })
  }

  /** Row class composition: base + HEAD tint + selection (selection wins).
   * (`css` is an index-signature record, so noUncheckedIndexedAccess types
   * every class as possibly absent — the base falls back to ''.) */
  const rowClass = (name: string): string => {
    let cls = css.menuRow ?? ''
    if (name === currentBranch) cls += ` ${css.menuRowSelected}`
    if (name === selected) cls += ` ${css.menuRowPicked}`
    return cls
  }

  /** The upstream divergence arrows of a local row (IDEA's ↑N/↓N) ahead of
   * the trailing check: plain text marks in the secondary tone — no base
   * icon pairs a direction with a count. Absent without an upstream or
   * when in sync. */
  const renderArrows = (row: BranchRow | null): React.ReactNode => {
    if (row === null) return null
    const marks: React.ReactNode[] = []
    if ((row.ahead ?? 0) > 0) {
      marks.push(<span key="ahead" className={css.menuRowArrow} title={t('aheadTitle', { n: row.ahead })}>↑{row.ahead}</span>)
    }
    if ((row.behind ?? 0) > 0) {
      marks.push(<span key="behind" className={css.menuRowArrow} title={t('behindTitle', { n: row.behind })}>↓{row.behind}</span>)
    }
    return marks
  }

  /** A row's click behavior: with a dialog open (delete confirm or a
   * worktree pick), clicking a row re-picks it (the flyout re-anchors);
   * without one it just selects (Enter or the row menu executes the
   * selected row — 签出 directly, no dialog).
   * `el` is nullable like {@link pick}'s anchor: a row whose button is
   * already unmounted still selects/picks, it just re-anchors nothing. */
  const rowClick = (el: HTMLButtonElement | null, name: string): void => {
    if (confirmOpen) pick(el, name)
    else setSelected(name)
  }

  /** Shared row pointer wiring — the three render shapes (tree leaf, flat
   * worktree row, search hit) bind ONE behavior set: hover tooltip gating,
   * click-select (with confirm-flyout re-anchor while it is open), and the
   * RIGHT-CLICK row menu. Execution lives on two channels: Enter (the
   * keyboard path, see the document keydown handler) and the context menu
   * (the mouse path — 签出/跳转 funnel through the same `pick` the removed
   * double-click used). The context menu only replaces the browser's native
   * one over rows (headers, toolbar, and the search field keep it) and
   * neither selects nor picks on open, so it adds a surface, never a second
   * semantics. No shift-guard arming: the menu moves nothing. */
  const rowEvents = (row: BranchRow | null, name: string): React.HTMLAttributes<HTMLButtonElement> => ({
    onClick: () => { if (guardActive()) return; rowClick(buttonOf(name), name) },
    onMouseEnter: (event) => { gateTooltip(event.currentTarget, name) },
    onMouseLeave: (event) => { clearTooltip(event.currentTarget) },
    onContextMenu: (event) => {
      event.preventDefault()
      setCtx({ row, name, x: event.clientX, y: event.clientY })
    },
  })

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

  /** One top-level group header (local/remote branches): the folder-header
   * posture with its own open flag — toggling flips the flag, never a key
   * in the expanded path set. `menuGroupTop` lifts the tone above the
   * folder headers (see the CSS note). In the search view (onToggle
   * absent) it renders inert: the matched subtrees below are force-open
   * anyway. */
  const renderGroupHeader = (label: string, count: number, open: boolean, onToggle?: () => void): React.ReactNode => {
    const cls = `${css.menuGroup} ${css.menuGroupTop}`
    return (
      onToggle === undefined
        ? (
          <div className={cls} role="presentation" style={{ paddingLeft: 8 }}>
            <IconChevronDownOutlineRegular size={12} className={css.menuGroupChevron} />
            <span className={css.menuGroupLabel}>{label}</span>
            <span className={css.menuGroupCount}>({count})</span>
          </div>
        )
        : (
          <button
            type="button"
            className={cls}
            aria-expanded={open}
            onClick={() => {
              if (guardActive()) return
              onToggle()
              armShiftGuard()
            }}
          >
            <IconChevronRightOutlineRegular
              size={12}
              className={open ? `${css.menuGroupChevron} ${css.menuGroupChevronOpen}` : css.menuGroupChevron}
            />
            <span className={css.menuGroupLabel}>{label}</span>
            <span className={css.menuGroupCount}>({count})</span>
          </button>
        )
    )
  }

  /**
   * One tree group-header row: its own segment (a compressed chain's
   * walked segments join the label), a count badge, and a chevron that
   * turns for expansion. Clicking toggles. One color throughout — the
   * folder path is not color-distinguished from the name. `prefix` scopes
   * the expanded-key space to the owning group (see groupKey) and keeps
   * React keys unique across the two trees.
   */
  const renderHeader = (node: TreeNode, label: string, depth: number, prefix: string): React.ReactNode => {
    const isOpen = expanded.has(`${prefix}${node.path}`)
    return (
      <button
        key={`${prefix}group:${node.path}`}
        type="button"
        className={css.menuGroup}
        data-group={node.path}
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-expanded={isOpen}
        onClick={() => {
          if (guardActive()) return
          toggle(`${prefix}${node.path}`)
          armShiftGuard()
        }}
      >
        <IconChevronRightOutlineRegular
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
   * the context survives without a pointless one-entry folder. The
   * data-branch key stays the group-local DISPLAY name — unique across
   * all groups (a remote display name can never equal a local row; a
   * worktree row's branch has left the local group) — which is what the
   * buttonOf/commitFirst/center lookups rely on. */
  const renderLeaf = (node: TreeNode, label: string, depth: number, prefix: string): React.ReactNode => (
    <button
      key={`${prefix}${node.path}`}
      type="button"
      role="menuitem"
      data-branch={node.path}
      data-kind={node.leaf?.kind}
      className={rowClass(node.path)}
      style={{ paddingLeft: 8 + depth * 12 + LEAF_CHEVRON_SLOT }}
      {...rowEvents(node.leaf, node.path)}
    >
      <span className={css.menuRowLabel}>{label}</span>
      {renderArrows(node.leaf)}
      {node.path === currentBranch && <IconCheckOutlineRegular size={14} />}
    </button>
  )

  /** One flat worktree row: a direct hop target, one per linked worktree
   * — no tree (worktree names rarely fork, and the group is a launcher,
   * not a taxonomy), no confirm (the row menu's 跳到此工作树 IS the hop;
   * the owner picks it up through onSelect). The native title carries the
   * worktree DIRECTORY — the fact a branch row cannot show. The row the
   * session currently lives in keeps the trailing check + HEAD tint: it is
   * the "you are here" mark the local group no longer holds (its branch
   * was filed into THIS group). */
  const renderFlatLeaf = (row: BranchRow, prefix: string): React.ReactNode => (
    <button
      key={`${prefix}${row.name}`}
      type="button"
      role="menuitem"
      data-branch={row.name}
      data-kind={row.kind}
      className={rowClass(row.name)}
      title={row.path}
      style={{ paddingLeft: 8 + 12 + LEAF_CHEVRON_SLOT }}
      {...rowEvents(row, row.name)}
    >
      <span className={css.menuRowLabel}>{row.name}</span>
      {renderArrows(row)}
      {row.name === currentBranch && <IconCheckOutlineRegular size={14} />}
    </button>
  )

  /** Recursive tree renderer. Linear chains — nodes that are neither a
   * branch nor a real fork — compress into the next row's label, so
   * `feature/优化` stays a single flat row instead of a pointless one-entry
   * folder, while a real fork (`a/deep/tree` holding leaf1+leaf2) gets a
   * header whose children show only their own segments. */
  const renderTree = (nodes: TreeNode[], depth: number, prefix: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (const node of nodes) {
      let cur = node
      const parts: string[] = []
      while (cur.leaf === null && cur.children.length === 1) {
        const next = cur.children[0]
        if (next === undefined) break
        parts.push(cur.segment)
        cur = next
      }
      const label = parts.length === 0 ? cur.segment : `${parts.join('/')}/${cur.segment}`
      if (cur.leaf !== null) {
        out.push(renderLeaf(cur, label, depth, prefix))
        // A branch that is also a folder path (`feature` next to
        // `feature/x`): keep the pickable row and fold the children under
        // a second, toggle-only header of the same name (rare coexistence).
        if (cur.children.length > 0) {
          out.push(renderHeader(cur, label, depth, prefix))
          if (expanded.has(`${prefix}${cur.path}`)) out.push(...renderTree(cur.children, depth + 1, prefix))
        }
      } else {
        out.push(renderHeader(cur, label, depth, prefix))
        if (expanded.has(`${prefix}${cur.path}`)) out.push(...renderTree(cur.children, depth + 1, prefix))
      }
    }
    return out
  }

  /** Search view: keep matching leaves AND their ancestor folders (IDEA's
   * filter keeps the path), hide non-matching siblings, force every kept
   * folder open, and highlight the hit substring. No chain compression —
   * the full ancestor path is exactly the context the search is for. */
  /** Needle-matching leaf count of a tree: the search-view group header
   * must count the MATCHES under it, not the whole group — a full count
   * above two filtered rows reads as a lie. */
  const searchLeafCount = (nodes: TreeNode[]): number =>
    nodes.reduce((sum, node) => sum
      + (node.leaf !== null && node.leaf.name.toLowerCase().includes(needle) ? 1 : 0)
      + searchLeafCount(node.children), 0)

  const renderSearch = (nodes: TreeNode[], depth: number, prefix: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (const node of nodes) {
      const leafHit = node.leaf !== null && node.leaf.name.toLowerCase().includes(needle)
      const childHit = subtreeMatches(node.children)
      if (leafHit) {
        out.push(
          <button
            key={`${prefix}${node.path}`}
            type="button"
            role="menuitem"
            data-branch={node.path}
            data-kind={node.leaf?.kind}
            className={rowClass(node.path)}
            style={{ paddingLeft: 8 + depth * 12 + LEAF_CHEVRON_SLOT }}
            {...rowEvents(node.leaf, node.path)}
          >
            <span className={css.menuRowLabel}>{renderLabel(node.segment)}</span>
            {renderArrows(node.leaf)}
            {node.path === currentBranch && <IconCheckOutlineRegular size={14} />}
          </button>,
        )
      }
      if (childHit) {
        out.push(
          <div
            key={`${prefix}search:${node.path}`}
            role="presentation"
            className={css.menuGroup}
            data-group={node.path}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <IconChevronDownOutlineRegular size={12} className={css.menuGroupChevron} />
            <span className={css.menuGroupLabel}>{renderLabel(node.segment)}</span>
            <span className={css.menuGroupCount}>({node.total})</span>
          </div>,
        )
        out.push(...renderSearch(node.children, depth + 1, prefix))
      }
    }
    return out
  }

  /** The row menu's items — for a BRANCH row, the six-verb set (签出 /
   * 新建 / 新建并检出 / 重命名分支 / 删除分支 / 复制分支), each degenerating
   * where it has no object: the current branch drops 签出 AND 删除 (git
   * refuses a delete of the checked-out branch anyway), worktree mode and
   * linked-worktree sessions drop the write trio + delete (canCreate — the
   * gate the removed toolbar plus lived under), remote rows drop 重命名
   * and 删除 (a remote branch is not ours to rename or delete), and a
   * LOCKED row drops 签出 and the hop — the owner answers those picks
   * with the main-checkout toast, so the verb leaves with the refusal.
   * 签出 and the hop go through `pick` DIRECTLY — no confirmation step (the owner
   * executes the switch in place, keep-open; a worktree-mode pick stages
   * the owner's worktree dialog instead). 新建 / 新建并检出 open the
   * create flyout with the row as the start point (`from`; 新建并检出 adds
   * `checkout` — `git switch -c <name> <from>` — while 新建 leaves every
   * checkout untouched), 重命名 the rename flyout, 删除 the owner's
   * confirm flyout (the safe `git branch -d`). A WORKTREE row keeps its
   * launcher set (hop + copy path + 删除工作树): its job is hopping, and its
   * branch is by definition checked out elsewhere — the removal deletes
   * THAT worktree (git first, archives and unregistration after, branch
   * kept), staged through the owner's confirm, never run directly, and a
   * directory holding a running session withholds it. While the session is
   * BLANK (canWorktree) the two worktree verbs join the set BELOW 新建并
   * 检出 (isolation reads as the heavier variant of branching) — 创建工作
   * 树 (the owner stages the reuse/new/remote-twin ask via `onWorktree`;
   * routing it through `pick` would land on the plain in-place 签出) and
   * 新建分支并创建工作树 (the owner's cutout dialog, name typed by hand,
   * cut from THIS row); a started session drops them — its directory is
   * fixed. Copy is client-only (WYSIWYG display names; a successful write
   * toasts the shared copied label). The menu opens NEITHER select NOR
   * pick — it launches, never re-semantics. */
  const ctxItems: { id: string; label: string; icon: React.ReactNode; disabled?: boolean; title?: string; run: () => void }[] = []
  if (ctx !== null) {
    const { row, name, x, y } = ctx
    const isWorktree = row?.kind === 'worktree'
    // The two EXECUTION verbs (签出 and 跳到此工作树) are withheld from the
    // CURRENT branch: git refuses a second checkout of a branch that is
    // already out, so the verb would be a guaranteed dead end there. Every
    // other row is actionable by construction (the owner never sends a
    // branch this directory must refuse — see the component doc).
    const executable = name !== currentBranch
    // Every verb that can stage a second-level flyout records where the
    // menu stood FIRST (setCtx below clears the menu state): the flyout
    // then replaces it in place instead of anchoring to the card.
    const markPoint = (): void => { ctxPointRef.current = { x, y } }
    const openCreate = (checkout: boolean): void => {
      confirmRef.current?.onCancel()
      setRenaming(null)
      markPoint()
      setCtx(null)
      setDraft('')
      setCreateBase(remoteNameMapRef.current.get(name) ?? name)
      setCreateCheckout(checkout)
      setCreating(true)
    }
    if (isWorktree) {
      if (executable) {
        ctxItems.push({
          id: 'hop',
          label: t('ctxHop'),
          icon: <IconRightUpOutlineRegular size={14} />,
          run: () => {
            markPoint()
            setCtx(null)
            setSelected(name)
            pick(buttonOf(name), name, true)
          },
        })
      }
      ctxItems.push({
        id: 'copy',
        label: t('ctxCopyPath'),
        icon: <IconCopyOutlineRegular size={14} />,
        run: () => {
          setCtx(null)
          const text = row?.path !== undefined ? row.path : name
          void writeClipboard(text).then(ok => { if (ok) setCopiedSeq(Date.now()) })
        },
      })
      // The destructive verb rides LAST (the branch rows put 删除分支 at the
      // bottom of their write block too): hop and copy are free, removal is
      // the one item that costs. It stages the owner's confirm — never runs
      // directly. A RUNNING session in the directory withholds the item (the
      // manager dialog's rule), the reason on hover; the MAIN checkout's row
      // (a linked-worktree session's way back home) withholds it entirely —
      // git refuses `worktree remove` on the main working tree.
      if (row?.path !== undefined && row.mainWorktree !== true) {
        const blocked = worktreeRemovalBlocked(row.path)
        ctxItems.push({
          id: 'remove-worktree',
          label: t('worktreeRemove.menu'),
          icon: <IconTrashOutlineRegular size={14} />,
          ...blocked ? { disabled: true, title: t('manager.running') } : {},
          run: () => {
            confirmRef.current?.onCancel()
            markPoint()
            setCtx(null)
            stagePending(buttonOf(name), name)
            onRemoveWorktree(row.path ?? '', name)
          },
        })
      }
    } else {
      if (executable) {
        ctxItems.push({
          id: 'checkout',
          label: t('ctxCheckout'),
          icon: <IconBranchOutlineRegular size={14} />,
          run: () => {
            markPoint()
            setCtx(null)
            setSelected(name)
            pick(buttonOf(name), name, true)
          },
        })
      }
      if (canCreate) {
        ctxItems.push({
          id: 'create',
          label: t('ctxCreate'),
          icon: <IconPlusOutlineRegular size={14} />,
          run: () => { openCreate(false) },
        })
        ctxItems.push({
          id: 'create-checkout',
          label: t('ctxCreateCheckout'),
          icon: <IconBranchOutlineRegular size={14} />,
          run: () => { openCreate(true) },
        })
      }
      // Worktree verbs ride only while the session is BLANK (canWorktree):
      // a started session's directory is fixed, so isolating from here is
      // meaningless. They sit BELOW 新建并检出 (isolation reads as the
      // heavier variant of branching). 创建工作树 stages the owner's
      // reuse/new/remote-twin confirm directly — routing it through `pick`
      // would land on the plain in-place 签出. The cut verb stages the
      // owner's cutout dialog with the new branch name typed BY HAND, and
      // is offered on the CURRENT branch too — the plain add would refuse
      // there (the branch is checked out right here), the cut is exactly
      // the isolated-worktree move.
      if (canWorktree) {
        if (name !== currentBranch) {
          ctxItems.push({
            id: 'worktree',
            label: t('ctxWorktree'),
            icon: <IconProjectAddOutlineRegular size={14} />,
            run: () => {
              markPoint()
              setCtx(null)
              setSelected(name)
              stagePending(buttonOf(name), name)
              onWorktree(name)
            },
          })
        }
        ctxItems.push({
          id: 'worktree-cut',
          label: t('ctxWorktreeCut'),
          icon: <IconBranchOutlineRegular size={14} />,
          run: () => {
            markPoint()
            setCtx(null)
            stagePending(buttonOf(name), name)
            onCutWorktree(name)
          },
        })
      }
      if (canCreate) {
        if (row?.kind !== 'remote') {
          ctxItems.push({
            id: 'rename',
            label: t('ctxRename'),
            icon: <IconEditOutlineRegular size={14} />,
            run: () => {
              confirmRef.current?.onCancel()
              markPoint()
              setCtx(null)
              setCreating(false)
              setDraft('')
              setCreateBase(undefined)
              setCreateCheckout(false)
              setRenaming({ name, draft: name })
            },
          })
          // Delete skips the CURRENT branch outright — the item is not even
          // offered (git refuses to delete the checked-out branch, so it
          // would be a guaranteed dead end). The SAFE `-d` form sits behind
          // the owner's confirm flyout — a menu click must never discard
          // commits. Rename of the current branch STAYS: `git branch -m`
          // follows the HEAD ref legally.
          if (name !== currentBranch) {
            ctxItems.push({
              id: 'delete',
              label: t('ctxDelete'),
              icon: <IconTrashOutlineRegular size={14} />,
              run: () => {
                confirmRef.current?.onCancel()
                markPoint()
                setCtx(null)
                stagePending(buttonOf(name), name)
                onDelete(name)
              },
            })
          }
        }
      }
      ctxItems.push({
        id: 'copy',
        label: t('ctxCopyName'),
        icon: <IconCopyOutlineRegular size={14} />,
        run: () => {
          setCtx(null)
          void writeClipboard(name).then(ok => { if (ok) setCopiedSeq(Date.now()) })
        },
      })
    }
  }

  /** The create flyout's ask line. The base branch is the whole difference
   * between "new branch" and "new branch from THAT row" — the row that was
   * right-clicked is no longer visible once the menu is replaced by this
   * flyout (and near a viewport edge the menu had already detached from
   * it), so the ask has to carry it. No base = the toolbar-era in-place
   * create, which has nothing to name. */
  const createAsk = createBase === undefined
    ? t('createFlyAsk')
    : t('createFlyAskFrom', { branch: displayNameOf(createBase) })

  /**
   * Arrow/Enter/Home/End inside the row menu. Items are read from the DOM
   * rather than from `ctxItems` so the focused item IS the source of truth
   * (no index state to drift). Wrapping at both ends: a six-item transient
   * is faster to cycle than to aim at. Escape is NOT handled here — the
   * document listener already unwinds the menu first, and its ordering
   * against the flyouts belongs in one place.
   */
  const ctxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const key = event.key
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End' && key !== 'Enter') return
    const items = [...(ctxCardRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])') ?? [])]
    if (items.length === 0) return
    if (key === 'Enter') {
      // Let the button's own click handling run: preventing it here would
      // swallow the activation the user just asked for.
      return
    }
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = key === 'Home'
      ? 0
      : key === 'End'
        ? items.length - 1
        : key === 'ArrowDown'
          ? (at + 1) % items.length
          : (at <= 0 ? items.length - 1 : at - 1)
    items[next]?.focus()
  }

  return (
    <>
      {createPortal(
        <div
          ref={cardRef}
          className={css.menuCard}
          style={{ left: pos.left, bottom: pos.bottom }}
          role="menu"
          aria-label={t('menuBranches')}
        >
          <div className={css.menuToolbar} role="toolbar" aria-label={t('menuBranches')}>
            {/* The toolbar's old plus (create from current) is GONE — branch
              * writing lives in the row context menu (新建 / 新建并检出 /
              * 重命名 / 删除), where the target branch is the row under the
              * cursor. The strip keeps the read-only tools: locate, update,
              * fetch, expand/collapse. */}
            <button
              type="button"
              className={css.menuToolButton}
              title={t('menuLocate')}
              aria-label={t('menuLocate')}
              onClick={locateCurrent}
            >
              <IconGoalOutlineRegular size={16} />
            </button>
            <button
              type="button"
              className={updateBusy ? `${css.menuToolButton} ${css.menuToolButtonRunning}` : css.menuToolButton}
              title={t('menuUpdate')}
              aria-label={t('menuUpdate')}
              disabled={busy || fetchBusy}
              onClick={() => {
                // A staged confirm must not ride out the update: while it
                // runs, busy would flip its labels into progress text for
                // an action nobody is running.
                confirmRef.current?.onCancel()
                onUpdate()
              }}
            >
              <FetchGlyph dashed={false} />
            </button>
            <button
              type="button"
              className={fetchBusy ? `${css.menuToolButton} ${css.menuToolButtonRunning}` : css.menuToolButton}
              title={t('menuFetch')}
              aria-label={t('menuFetch')}
              disabled={busy || updateBusy}
              onClick={() => {
                // A staged confirm must not ride out the sync: while the
                // fetch runs, busy would flip its labels into progress text
                // for an action nobody is running.
                confirmRef.current?.onCancel()
                onFetch()
              }}
            >
              <FetchGlyph />
            </button>
            <button
              type="button"
              className={css.menuToolButton}
              title={allExpanded ? t('menuCollapseAll') : t('menuExpandAll')}
              aria-label={allExpanded ? t('menuCollapseAll') : t('menuExpandAll')}
              // The group headers fold too, so the tool stays live whenever
              // any row exists — folders alone no longer gate it. The
              // search view is the one exception: it renders a flat,
              // force-expanded list with no folders to fold, so the button
              // would toggle state nobody can see (and then surprise the
              // user with it once the query clears).
              disabled={rows.length === 0 || needle !== ''}
              onClick={toggleAll}
            >
              {allExpanded ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
            </button>
          </div>
          <div className={css.menuMain}>
            <div className={css.menuHeading}>{t('menuBranches')}</div>
            <div className={css.menuRows} role="presentation" ref={holdRowsCenter}>
              {needle === '' ? (
                <>
                  {grouped.localRows.length > 0 && renderGroupHeader(t('menuLocalBranches'), grouped.localRows.length, localGroupOpen,
                    () => setLocalGroupOpen(value => !value))}
                  {localGroupOpen && renderTree(localTree, 1, 'local:')}
                  {pickableWorktreeRows.length > 0 && (
                    <>
                      {renderGroupHeader(t('menuWorktrees'), pickableWorktreeRows.length, worktreeGroupOpen,
                        () => setWorktreeGroupOpen(value => !value))}
                      {worktreeGroupOpen && pickableWorktreeRows.map(row => renderFlatLeaf(row, 'worktree:'))}
                    </>
                  )}
                  {grouped.remoteDisplayRows.length > 0 && (
                    <>
                      {renderGroupHeader(t('menuRemoteBranches'), grouped.remoteDisplayRows.length, remoteGroupOpen,
                        () => setRemoteGroupOpen(value => !value))}
                      {remoteGroupOpen && renderTree(remoteTree, 1, 'remote:')}
                    </>
                  )}
                </>
              ) : (
                <>
                  {grouped.localRows.some(row => row.name.toLowerCase().includes(needle)) && (
                    <>
                      {renderGroupHeader(t('menuLocalBranches'), searchLeafCount(localTree), true)}
                      {renderSearch(localTree, 1, 'local:')}
                    </>
                  )}
                  {pickableWorktreeRows.some(row => row.name.toLowerCase().includes(needle)) && (
                    <>
                      {renderGroupHeader(t('menuWorktrees'), pickableWorktreeRows.filter(row => row.name.toLowerCase().includes(needle)).length, true)}
                      {pickableWorktreeRows
                        .filter(row => row.name.toLowerCase().includes(needle))
                        .map(row => renderFlatLeaf(row, 'worktree:'))}
                    </>
                  )}
                  {grouped.remoteDisplayRows.some(row => row.name.toLowerCase().includes(needle)) && (
                    <>
                      {renderGroupHeader(t('menuRemoteBranches'), searchLeafCount(remoteTree), true)}
                      {renderSearch(remoteTree, 1, 'remote:')}
                    </>
                  )}
                </>
              )}
              {/* Two distinct empties: a filter that matched nothing
                * ("no MATCHES") versus a menu with no rows at all — a
                * detached HEAD's started worktree session, a fresh repo.
                * "No matching branches" under zero rows would blame the
                * search the user never typed. */}
              {visible.length === 0
                && <div className={css.menuEmpty}>{rows.length === 0 ? t('menuNoBranches') : t('menuNoMatches')}</div>}
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
                  if (event.key === 'Enter' && !event.altKey) {
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
          {confirm.subject !== undefined && <p className={css.popSubject}>{confirm.subject}</p>}
          {confirm.details !== undefined && <div className={css.popDetails}>{confirm.details}</div>}
          {confirm.onDraftChange !== undefined && (
            <>
              <input
                ref={flyInputRef}
                className={css.menuCreate}
                type="text"
                value={confirm.draft ?? ''}
                placeholder={confirm.draftPlaceholder}
                aria-label={confirm.draftPlaceholder}
                aria-invalid={confirm.draftInvalid === true}
                spellCheck={false}
                disabled={confirm.busy}
                onChange={event => { confirm.onDraftChange?.(event.target.value) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (confirm.draftInvalid !== true && !confirm.busy) confirm.onConfirm()
                  }
                }}
              />
              {confirm.draftInvalid === true && confirm.draftHint !== undefined && (
                <p className={css.menuCreateHintBad} role="status">{confirm.draftHint}</p>
              )}
            </>
          )}
          <div className={css.popActions}>
            <button type="button" disabled={confirm.busy} onClick={confirm.onCancel}>
              {confirm.cancelLabel}
            </button>
            <button
              ref={flyConfirmRef}
              type="button"
              disabled={confirm.busy || confirm.draftInvalid === true}
              onClick={confirm.onConfirm}
            >
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
          aria-label={createAsk}
        >
          <p className={css.popAsk}>{createAsk}</p>
          <input
            ref={createInputRef}
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
            <button
              type="button"
              disabled={!createValid || busy}
              onClick={commitCreate}
            >
              {busy ? t('createBranchBusy') : createCheckout ? t('createCheckoutConfirm') : t('actionConfirm')}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {renaming !== null && createPortal(
        <div
          ref={renameFlyRef}
          className={css.popCard}
          style={renameFlyPos ?? FLY_MEASURE}
          role="dialog"
          aria-label={t('renameBranchTitle', { branch: renaming.name })}
        >
          <p className={css.popAsk}>{t('renameBranchTitle', { branch: renaming.name })}</p>
          <input
            ref={renameInputRef}
            className={css.menuCreate}
            type="text"
            value={renaming.draft}
            placeholder={t('menuNewBranchPlaceholder')}
            aria-label={t('menuNewBranchPlaceholder')}
            aria-invalid={renameIssue !== null && renameIssue !== 'empty'}
            spellCheck={false}
            disabled={busy}
            onChange={event => { setRenaming(current => current === null ? current : { ...current, draft: event.target.value }) }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              }
            }}
          />
          {showRenameHint && (
            <p className={css.menuCreateHintBad} role="status">
              {renameDuplicate ? t('menuNewBranchExists') : t('menuNewBranchBad')}
            </p>
          )}
          <div className={css.popActions}>
            <button type="button" disabled={busy} onClick={() => { setRenaming(null) }}>
              {t('actionCancel')}
            </button>
            <button type="button" disabled={!renameValid || busy} onClick={commitRename}>
              {busy ? t('renameBranchBusy') : t('actionConfirm')}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {ctx !== null && createPortal(
        <div
          ref={ctxCardRef}
          className={css.ctxCard}
          style={ctxPos ?? FLY_MEASURE}
          role="menu"
          aria-label={ctx.name}
          onKeyDown={ctxKeyDown}
        >
          {/* Whose row this is. The menu is cursor-anchored and clamped to
            * the viewport, so near an edge it detaches from the row that
            * opened it — and with the double-click gone this menu is the
            * only mouse path to every verb in it. Naming the target is what
            * keeps "delete branch" from being a guess. */}
          <div className={css.ctxHeader} title={ctx.name}>{ctx.name}</div>
          {ctxItems.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={css.ctxItem}
              disabled={item.disabled}
              title={item.title}
              onClick={item.run}
            >
              {item.icon}
              <span className={css.ctxItemLabel}>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {copiedSeq !== null && <Toast key={copiedSeq} text={t('hover.copied')} onDone={() => { setCopiedSeq(null) }} />}
    </>
  )
}
