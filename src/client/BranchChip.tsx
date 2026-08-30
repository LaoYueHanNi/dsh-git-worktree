/**
 * BranchChipDock: the composer tool-row entry (conversation.input.left, right
 * of the mode chips) for sessions inside a git repository. Blank sessions
 * get the full segmented control — branch picker plus the worktree
 * isolation toggle — because that is the moment to choose the environment
 * for the conversation. Once the session starts, the worktree toggle is
 * withdrawn: a started session may still switch branches in place (a
 * switch inside a linked worktree checks out within that worktree —
 * probeRepo roots at the session directory's toplevel, never the main
 * checkout), but its directory is fixed. Non-git directories and load
 * failures render nothing. The confirm dialogs and the error toast live
 * here too.
 *
 * Checking the worktree toggle pops the cutout confirm dialog right away:
 * confirming it cuts a NEW branch (`<current>-wt`, suffixes past taken
 * names) out of the current checkout into a fresh isolated worktree — the
 * current branch itself is occupied by the main worktree, so git refuses a
 * second worktree on it. The dialog stands alone above the chip (the
 * branch menu stays closed); the chip still opens the menu, where picking
 * another branch keeps the plain create-or-reuse flow and re-picking the
 * current branch stages the same cutout confirm. Dismissing the dialog and
 * sending the message anyway means the user knowingly stays in the current
 * directory — no separate notice fires on send.
 *
 * In-place branch creation (the menu toolbar's plus, worktree mode off)
 * opens the create flyout right of the branch card: type the name, press
 * Create — the new branch is cut from the session directory's current
 * checkout and checked out there in one stroke, the worktree-less sibling
 * of the cutout flow. A failure toasts and leaves the flyout open.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, IconBranchOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { localBranchName } from '../normalize.ts'
import type { BranchEntry, RepoStatus, WorktreeEntry } from '../wire.ts'
import { fetchStatus, requestCreateBranch, requestFetch, requestSwitch, requestUpdate, requestWorktree, requestWorktreeCutout } from './api.ts'
import { BranchMenu, type BranchRow } from './BranchMenu.tsx'
import type { BranchChipInjected } from './slots.ts'
import css from './BranchChip.module.css'

/**
 * Heavier check glyph for the worktree toggle. The base's IconCheckOutline16
 * is a fill path (fixed visual weight); we need a visibly bolder stroke to
 * read inside the 14×14 bluish fill — local to this module so the heavier
 * weight doesn't leak into the rest of the composer chrome.
 */
function WorktreeCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.2 8.4 L6.6 11.8 L12.8 4.4"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Full props: owner share + standard kit + injected adopt verb + locale seat. */
export type BranchChipDockProps =
  PropsRuntime<'conversation.input.left'>
  & BranchChipInjected
  & PropsLocale<'git-worktree'>

/** Status fetch lifecycle: `null` facts until ready; failures park unloaded. */
interface StatusState {
  facts: (RepoStatus & { repo: true }) | null
}

/** One pending confirm dialog. */
interface ConfirmState {
  kind: 'switch' | 'worktree' | 'worktree-cutout'
  branch: string
}

/**
 * Read the repository status for a directory; refetch on demand.
 * @param cwd - absolute session directory.
 * @returns the state holder and a refetch verb.
 */
function useRepoStatus(cwd: string | undefined): readonly [StatusState, () => Promise<void>] {
  const [state, setState] = useState<StatusState>({ facts: null })
  const load = useCallback(async (): Promise<void> => {
    if (cwd === undefined) {
      setState({ facts: null })
      return
    }
    const result = await fetchStatus(cwd)
    setState({ facts: result.ok && result.repo ? result : null })
  }, [cwd])
  useEffect(() => {
    let live = true
    setState({ facts: null })
    if (cwd !== undefined) {
      void fetchStatus(cwd).then(result => {
        if (live) setState({ facts: result.ok && result.repo ? result : null })
      })
    }
    return () => { live = false }
  }, [cwd])
  return [state, load]
}

/** Longest branch name shown on the chip before ellipsizing (chars, … included). */
const BRANCH_DISPLAY_MAX = 25

/** Viewport edge clearance and chip gap, mirroring BranchMenu's posture. */
const POP_MARGIN = 12
const POP_GAP = 6
/** Unplaced dialog: hidden but laid out at a fixed origin so offsetWidth is
 * real for the measure-then-place pass (BranchMenu's flyout trick). */
const POP_MEASURE: Partial<CSSStyleDeclaration> = { left: '-9999px', bottom: '0px', visibility: 'hidden' }

/**
 * Clamp a branch name for chip display: names up to 25 chars pass through;
 * longer ones show the first 24 chars plus an ellipsis.
 * @param branch - full branch name.
 */
function displayBranch(branch: string): string {
  return branch.length <= BRANCH_DISPLAY_MAX ? branch : `${branch.slice(0, BRANCH_DISPLAY_MAX - 1)}…`
}

/**
 * Build the branch rows for the picker: local branches only (remote
 * branches are not offered). A branch already checked out by a live
 * worktree is disabled while the worktree toggle is off (git refuses such
 * a switch); with the toggle on it is the reuse path, so it stays
 * selectable. The selected row's trailing check is BranchMenu's own
 * affordance — no leading icon.
 */
function buildBranchRows(
  branches: readonly BranchEntry[],
  worktrees: readonly WorktreeEntry[],
  currentBranch: string,
  worktreeMode: boolean,
): BranchRow[] {
  const occupied = new Set(worktrees.flatMap(w => w.branch === undefined ? [] : [w.branch]))
  return branches
    .filter(b => b.kind === 'local')
    .map(branch => ({
      name: branch.name,
      disabled: branch.name !== currentBranch && !worktreeMode && occupied.has(localBranchName(branch.name)),
    }))
}

/** The standalone confirm dialog shown while the branch menu is closed. */
interface ChipConfirmProps {
  /** The chip element — the dialog's bottom edge pins just above its top. */
  anchorRef: React.RefObject<HTMLElement | null>
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
  /** Dismiss the dialog without acting. */
  onCancel: () => void
}

/**
 * The check-time confirm dialog, rendered while the branch menu is closed:
 * the same popCard chrome as BranchMenu's flyout, but bottom-pinned above
 * the chip in the menu card's posture — the flyout's right-of-card anchor
 * has no card to sit beside here. Outside pointerdown and Escape cancel;
 * the confirm button takes focus so Enter commits.
 */
function ChipConfirm({ anchorRef, ask, confirmLabel, cancelLabel, busy, onConfirm, onCancel }: ChipConfirmProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  // Bottom-pin above the chip and clamp horizontally against the measured,
  // content-driven width (popCard is max-content under an 80vw cap).
  useLayoutEffect(() => {
    const place = (): void => {
      const anchor = anchorRef.current
      const pop = popRef.current
      if (anchor === null || pop === null) return
      const rect = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = Math.min(Math.max(rect.left, POP_MARGIN), Math.max(POP_MARGIN, vw - POP_MARGIN - pop.offsetWidth))
      setPos({ left, bottom: vh - rect.top + POP_GAP })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef])

  // Focus rides a rAF: the first frame lays the dialog out in the hidden
  // measure-then-place posture, and focus() on a visibility:hidden node
  // no-ops — one frame later the placed dialog is visible and the focus
  // lands.
  useEffect(() => {
    const raf = requestAnimationFrame(() => { confirmRef.current?.focus() })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  // Outside pointerdown cancels (the dialog and the chip excluded — the
  // chip click runs its own toggle); Escape unwinds the dialog.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (popRef.current?.contains(event.target as Node) === true) return
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
  }, [onCancel, anchorRef])

  return createPortal(
    <div ref={popRef} className={css.popCard} style={pos ?? POP_MEASURE} role="dialog" aria-label={ask}>
      <p className={css.popAsk}>{ask}</p>
      <div className={css.popActions}>
        <button type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button ref={confirmRef} type="button" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** The tool-row entry registered into conversation.input.left. */
export function BranchChipDock({ session, sessionId, useSessions, adoptWorktree, t }: BranchChipDockProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const cwd = summary?.cwd
  const [repo, refresh] = useRepoStatus(cwd)
  const [menuOpen, setMenuOpen] = useState(false)
  const [worktreeMode, setWorktreeMode] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState(false)
  /** Which arrow is spinning: fetch and update are single-flight against
   * the SAME busyRef (mutually exclusive), but the spinning state must be
   * per-tool — one shared flag made both arrows rotate at once. */
  const [fetchBusy, setFetchBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    // A moved session directory means a new repository context: the staged
    // toggle and any half-open dialog belong to the old one.
    setWorktreeMode(false)
    setConfirm(null)
    setMenuOpen(false)
  }, [cwd])

  useEffect(() => {
    // The session started: the environment is fixed now, so a toggle staged
    // during the blank phase must not survive into branch switching — nor
    // its confirm: a keyboard-only send (no outside pointerdown to dismiss
    // it) can start the session while the cutout dialog still floats over a
    // withdrawn toggle. Switch confirms stay: in-place branch switching is
    // a started-session feature.
    if (!session.blank) {
      setWorktreeMode(false)
      setConfirm(current => current !== null && current.kind !== 'switch' ? null : current)
    }
  }, [session.blank])

  // External branch changes (terminal, other tools) never reach this chip
  // on their own — the status fetch runs on mount, on cwd change, and after
  // our own switches. Two cheap pull points cover the real workflow:
  // regaining window focus (the user returns from the terminal where the
  // branches moved; refreshes the chip label) and opening the menu (fresh
  // rows exactly at decision time, see the chip's onClick). A push channel
  // (host-side fs.watch on .git/refs + SSE) was considered and skipped:
  // these pulls hide all but the menu-open-while-branches-change race, at
  // none of that complexity.
  useEffect(() => {
    const refreshIfIdle = (): void => {
      if (busyRef.current) return
      void refresh()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refreshIfIdle()
    }
    window.addEventListener('focus', refreshIfIdle)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refreshIfIdle)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const showError = useCallback((message: string) => {
    setToast({ seq: Date.now(), text: t('errorGeneric', { message }) })
  }, [t])

  /** Run one guarded confirm action: single-flight, toast on failure, close on success. */
  const runGuarded = useCallback(async (action: () => Promise<string | undefined>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const failure = await action()
    busyRef.current = false
    setBusy(false)
    if (failure !== undefined) {
      showError(failure)
      return
    }
    setConfirm(null)
    setMenuOpen(false)
  }, [showError])

  /** In-place switch flow: POST /switch, then refetch the status. */
  const doSwitch = useCallback((branch: string) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestSwitch(cwd, branch)
    if (!result.ok) return result.error
    await refresh()
    return undefined
  }), [cwd, refresh, runGuarded])

  /** Create-branch flow: POST /branch (create from the current checkout and
   * switch to it in place), then refetch the status — the menu closed by
   * then, and the chip label must name the new branch. Fired directly by
   * the menu's create flyout (no confirm kind): typing the name into the
   * flyout and pressing Create is the intent. */
  const doCreateBranch = useCallback((name: string) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestCreateBranch(cwd, name)
    if (!result.ok) return result.error
    await refresh()
    return undefined
  }), [cwd, refresh, runGuarded])

  /** Remote-sync flow: POST /fetch (fetch every remote + prune), then
   * refetch the status. Deliberately NOT runGuarded: its success closes the
   * menu, while the whole point of a sync is watching the refreshed branch
   * list in place. Single-flight shares busyRef with the other actions, so
   * a sync and a confirm action can never interleave. A network fetch has
   * NO visible side effect when the remote moved not — the spinning tool
   * (menu side) and the done toast here ARE the feedback. */
  const doFetch = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFetchBusy(true)
    const failure = await (async () => {
      if (cwd === undefined) return 'no session directory'
      const result = await requestFetch(cwd)
      if (!result.ok) return result.error
      return undefined
    })()
    busyRef.current = false
    setBusy(false)
    setFetchBusy(false)
    if (failure !== undefined) {
      showError(failure)
      return
    }
    await refresh()
    setToast({ seq: Date.now(), text: t('fetchDone') })
  }, [cwd, refresh, showError, t])

  /** Update-current-branch flow: POST /update (fetch every remote, then
   * fast-forward the checked-out branch to its upstream), then refetch the
   * status in place — same keep-the-menu-open semantics as the fetch sync.
   * The toast tells the two apart: fast-forwarded vs already up to date. */
  const doUpdate = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setUpdateBusy(true)
    const result = cwd === undefined ? undefined : await requestUpdate(cwd)
    busyRef.current = false
    setBusy(false)
    setUpdateBusy(false)
    if (result === undefined) {
      showError('no session directory')
      return
    }
    if (!result.ok) {
      showError(result.error)
      return
    }
    await refresh()
    setToast({
      seq: Date.now(),
      text: result.updated ? t('updateDone', { branch: result.branch }) : t('updateUpToDate'),
    })
  }, [cwd, refresh, showError, t])

  /** Worktree flow: POST /worktree (create-or-reuse, or cut out a new
   * branch), register the directory, hop sessions. */
  const doWorktree = useCallback((branch: string, cutout: boolean) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = cutout
      ? await requestWorktreeCutout(cwd, branch)
      : await requestWorktree(cwd, branch)
    if (!result.ok) return result.error
    try {
      await adoptWorktree(result.path)
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
    return undefined
  }), [adoptWorktree, cwd, runGuarded])

  const facts = repo.facts
  const rows = useMemo(
    () => facts === null ? [] : buildBranchRows(facts.branches, facts.worktrees, facts.currentBranch, worktreeMode),
    [facts, worktreeMode],
  )

  // Non-repo and still-loading directories render nothing at all.
  if (facts === null) return null

  const confirmLocalName = confirm === null ? '' : localBranchName(confirm.branch)
  // Reuse applies only to the plain create flow: a cutout always cuts a
  // fresh branch, so the current-branch confirm can never reuse.
  const existingWorktree = confirm === null || confirm.kind !== 'worktree'
    ? undefined
    : facts.worktrees.find(w => w.branch === confirmLocalName)

  /** One confirm bundle shared by the menu flyout and the standalone
   * dialog (whichever is showing). */
  const confirmBundle = confirm === null ? null : {
    ask: confirm.kind === 'worktree-cutout'
      ? t('worktreeAskCutOut', { branch: confirmLocalName })
      : confirm.kind === 'worktree'
        ? t(existingWorktree !== undefined ? 'worktreeAskReuse' : 'worktreeAskNew', { branch: confirmLocalName })
        : t('switchAsk', { branch: confirm.branch }),
    confirmLabel: busy
      ? (confirm.kind === 'worktree' || confirm.kind === 'worktree-cutout' ? t('worktreeBusy') : t('switchBusy'))
      : t('actionConfirm'),
    cancelLabel: t('actionCancel'),
    busy,
    onConfirm: () => {
      if (confirm.kind === 'worktree' || confirm.kind === 'worktree-cutout') {
        void doWorktree(confirm.branch, confirm.kind === 'worktree-cutout')
      } else {
        void doSwitch(confirm.branch)
      }
    },
    onCancel: () => { if (!busy) setConfirm(null) },
  }

  return (
    <>
      <span className={css.dock}>
        <button
          ref={chipRef}
          type="button"
          className={css.chip}
          title={facts.currentBranch}
          onClick={() => {
            // Toggling always unwinds any half-open confirm first.
            setConfirm(null)
            const opening = !menuOpen
            setMenuOpen(opening)
            // Fresh rows at decision time: branches may have moved outside
            // (terminal, other tools) since the last fetch. Non-blocking —
            // the menu opens on current data and re-renders when it lands.
            if (opening && !busyRef.current) void refresh()
          }}
        >
          <IconBranchOutline16 size={12} />
          <span className={css.branch}>{displayBranch(facts.currentBranch)}</span>
        </button>
        {/* The worktree toggle exists only for blank sessions: the started
         * session's directory is fixed, so its chip degrades to the plain
         * branch picker (the dock's only child then rounds all corners). */}
        {session.blank && (
          <>
            <span className={css.divider} aria-hidden="true" />
            <button
              type="button"
              className={worktreeMode ? css.checkOn : css.check}
              onClick={() => {
                // Checking stages the cutout confirm for the current branch
                // right away — the guidance IS the dialog, not a branch
                // list to explore. Unchecking clears it (and any menu)
                // again.
                const next = !worktreeMode
                setWorktreeMode(next)
                setMenuOpen(false)
                if (next) {
                  setConfirm({ kind: 'worktree-cutout', branch: facts.currentBranch })
                  if (!busyRef.current) void refresh()
                } else {
                  setConfirm(null)
                }
              }}
              title={t('worktreeToggle')}
            >
              <span className={css.box}>{worktreeMode ? <WorktreeCheck size={10} /> : null}</span>
              <span className={css.checkLabel}>{t('chipWorktree')}</span>
            </button>
          </>
        )}
      </span>
      <BranchMenu
        open={menuOpen}
        anchorRef={chipRef}
        rows={rows}
        currentBranch={facts.currentBranch}
        confirm={confirmBundle}
        canCreate={!worktreeMode}
        busy={busy}
        onCreate={(name) => { void doCreateBranch(name) }}
        onFetch={() => { void doFetch() }}
        fetchBusy={fetchBusy}
        onUpdate={() => { void doUpdate() }}
        updateBusy={updateBusy}
        onSelect={(branch) => {
          // In worktree mode re-selecting the CURRENT branch stages the
          // cut-out confirm; without the mode it is a plain close. Any
          // other pick stages the regular confirm flyout beside that row
          // (menu stays open).
          if (branch === facts.currentBranch) {
            if (worktreeMode) setConfirm({ kind: 'worktree-cutout', branch })
            else setMenuOpen(false)
            return
          }
          setConfirm({ kind: worktreeMode ? 'worktree' : 'switch', branch })
        }}
        onClose={() => { setMenuOpen(false) }}
        t={t}
      />
      {confirmBundle !== null && !menuOpen && (
        <ChipConfirm anchorRef={chipRef} {...confirmBundle} />
      )}
      {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
    </>
  )
}
