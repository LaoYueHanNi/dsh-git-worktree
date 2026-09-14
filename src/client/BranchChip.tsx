/**
 * BranchChipDock: the composer tool-row entry (conversation.input.left, right
 * of the mode chips) for sessions inside a git repository. Blank sessions
 * OF THE MAIN checkout get the full segmented control — branch picker plus
 * the worktree isolation toggle — because that is the moment to choose the
 * environment for the conversation, and starting a worktree is a main-repo
 * decision. Once the session starts, the worktree toggle is withdrawn (its
 * directory is fixed). A session inside a LINKED worktree scopes the whole
 * entry down: blank, the menu lists every branch for READING but every
 * pick but the current branch answers with the main-checkout hint (and
 * neither the toggle nor the in-place new-branch tool exists there);
 * started, the menu shows nothing but the session's own branch — fetch and
 * update-current stay, since neither moves the checkout (probeRepo still
 * roots at the session directory's toplevel, never the main checkout).
 * Non-git directories and load failures render nothing. The confirm
 * dialogs and the error toast live here too.
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
 *
 * Remote branches join the picker under their own menu group: picking one
 * stages the remote-twin confirm — the switch creates the local tracking
 * branch in place (git's dwim), the worktree pick creates the twin inside
 * its fresh worktree. Both rides go through the existing /switch and
 * /worktree routes, which already resolve `<remote>/name` display names.
 *
 * Branches held by linked worktrees get their own 「工作树」 group (blank
 * sessions only): they have left the local group — git refuses to check
 * them out twice, so a local-group row would be a dead end — and the row
 * menu's 「跳到此工作树」 hops the session straight into that worktree
 * directory (adoptWorktree; no git action, no confirm). A started session's
 * directory is fixed, so the group only exists while blank.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, IconBranchOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges SessionStandardProps / GlobalStandardProps (`sessionId`,
// `useSessions`) into the input-left runtime kit.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { branchNameIssue, localBranchName } from '../normalize.ts'
import type { BranchEntry, RepoStatus, WorktreeEntry } from '../wire.ts'
import { fetchStatus, requestCreateBranch, requestDeleteBranch, requestFetch, requestRenameBranch, requestSwitch, requestUpdate, requestWorktree, requestWorktreeCutout } from './api.ts'
import { BranchMenu, type BranchRow } from './BranchMenu.tsx'
import type { BranchChipInjected } from './slots.ts'
import css from './BranchChip.module.css'

/** Full props: owner share + standard kit + injected adopt verb + locale seat. */
export type BranchChipDockProps =
  PropsRuntime<'conversation.input.left'>
  & BranchChipInjected
  & PropsLocale<'git-worktree'>

/** Status fetch lifecycle: `null` facts until ready; failures park unloaded. */
interface StatusState {
  facts: (RepoStatus & { repo: true }) | null
}

/** One pending confirm dialog. Switches are NOT here — 签出 runs directly
 * (keep-open, no confirmation step); the confirms left are the ones with
 * real consequences to spell out or inputs to carry. */
interface ConfirmState {
  kind: 'worktree' | 'worktree-cutout' | 'delete'
  branch: string
  /** True when `branch` names a REMOTE branch (an `origin/feat-x` row):
   * the worktree confirm creates the twin plus its worktree — the ask line
   * spells that out instead of reading as a plain reuse. */
  remote?: boolean
  /** Editable cutout name (kind `worktree-cutout` only): starts EMPTY —
   * the user types the new branch name themselves (the auto `<branch>-wt`
   * prefill is gone), confirm disables until the draft is valid. */
  draft?: string
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
const POP_MEASURE: CSSProperties = { left: '-9999px', bottom: '0px', visibility: 'hidden' }

/**
 * Clamp a branch name for chip display: names up to 25 chars pass through;
 * longer ones show the first 24 chars plus an ellipsis.
 * @param branch - full branch name.
 */
function displayBranch(branch: string): string {
  return branch.length <= BRANCH_DISPLAY_MAX ? branch : `${branch.slice(0, BRANCH_DISPLAY_MAX - 1)}…`
}

/**
 * Build the branch rows for the picker in three kinds: LOCAL branches not
 * held by a linked worktree, REMOTE branches, and one WORKTREE row per
 * linked worktree. A branch held by a worktree LEAVES the local group —
 * git refuses to check it out twice, so the row would be a dead end; the
 * worktree group is the way INTO it instead (a direct session hop, see
 * the owner's onAdoptWorktree). The main worktree and detached worktrees
 * don't come along: the main checkout is home, not a hop target, and a
 * detached worktree has no branch name to offer.
 *
 * Inside a linked-worktree session every row but the current branch is
 * LOCKED (dimmed, still clickable): a pick reaches the owner, which
 * answers with the main-checkout hint — the dimming reads as "not usable
 * here" at a glance while the click keeps its explanation.
 */
function buildBranchRows(
  branches: readonly BranchEntry[],
  worktrees: readonly WorktreeEntry[],
  currentBranch: string,
  inLinkedWorktree: boolean,
): BranchRow[] {
  const held = new Set(worktrees.flatMap(w => w.main || w.branch === undefined ? [] : [w.branch]))
  const lock = (name: string): boolean => inLinkedWorktree && name !== currentBranch
  return [
    ...branches.filter(b => b.kind === 'local' && !held.has(b.name)).map(b => ({
      name: b.name,
      kind: 'local' as const,
      ...b.ahead === undefined ? {} : { ahead: b.ahead },
      ...b.behind === undefined ? {} : { behind: b.behind },
      locked: lock(b.name),
    })),
    ...branches.filter(b => b.kind === 'remote').map(b => ({
      name: b.name,
      kind: 'remote' as const,
      locked: lock(b.name),
    })),
    ...worktrees.flatMap(w => w.main || w.branch === undefined
      ? []
      : [{ name: w.branch, kind: 'worktree' as const, path: w.path, locked: lock(w.branch) }]),
  ]
}

/** The standalone confirm dialog shown while the branch menu is closed. */
interface ChipConfirmProps {
  /** The chip element — the dialog's bottom edge pins just above its top. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Ask line (already localized). */
  ask: string
  /** The branch the ask refers to, on its own weight-500 line (remote picks
   * only — the ask line says "该远程分支" and this names it). */
  subject?: string
  /** Confirm-button label (progress text while busy). */
  confirmLabel: string
  /** Cancel-button label. */
  cancelLabel: string
  /** True while the action runs: both buttons disable. */
  busy: boolean
  /** Editable new-branch name (cutout flow): present, the dialog renders a
   * naming input under the ask line and focuses IT instead of the confirm
   * button; Enter commits a valid draft. */
  draft?: string
  onDraftChange?: (value: string) => void
  draftPlaceholder?: string
  /** True while the draft is NOT an acceptable new branch name — the
   * confirm button disables in lockstep. */
  draftInvalid?: boolean
  /** Why the draft is invalid (rendered under the input; absent while the
   * draft is acceptable or merely empty). */
  draftHint?: string
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
 * the naming input (cutout flow) takes focus when present, else the
 * confirm button does so Enter commits.
 */
function ChipConfirm({
  anchorRef, ask, subject, confirmLabel, cancelLabel, busy,
  draft, onDraftChange, draftPlaceholder, draftInvalid, draftHint,
  onConfirm, onCancel,
}: ChipConfirmProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const draftInputRef = useRef<HTMLInputElement | null>(null)
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
  // lands. The naming input wins when present (typing is the point).
  useEffect(() => {
    const raf = requestAnimationFrame(() => { (draftInputRef.current ?? confirmRef.current)?.focus() })
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
      {subject !== undefined && <p className={css.popSubject}>{subject}</p>}
      {onDraftChange !== undefined && (
        <>
          <input
            ref={draftInputRef}
            className={css.menuCreate}
            type="text"
            value={draft}
            placeholder={draftPlaceholder}
            aria-label={draftPlaceholder}
            aria-invalid={draftInvalid}
            spellCheck={false}
            disabled={busy}
            onChange={event => { onDraftChange(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter' && draftInvalid !== true && !busy) {
                event.preventDefault()
                onConfirm()
              }
            }}
          />
          {draftInvalid === true && draftHint !== undefined && (
            <p className={css.menuCreateHintBad} role="status">{draftHint}</p>
          )}
        </>
      )}
      <div className={css.popActions}>
        <button type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          disabled={busy || draftInvalid === true}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** The tool-row entry registered into conversation.input.left. */
export function BranchChipDock({ sessionId, useSessions, useSession, adoptWorktree, pruneWorktrees, t }: BranchChipDockProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const session = useSession(s => s)
  const cwd = summary?.cwd
  const [repo, refresh] = useRepoStatus(cwd)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState(false)
  /** Which arrow is spinning: fetch and update are single-flight against
   * the SAME busyRef (mutually exclusive), but the spinning state must be
   * per-tool — one shared flag made both arrows rotate at once. */
  const [fetchBusy, setFetchBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  /** Toasts wait their turn instead of overwriting each other. One flow
   * can raise two in a row — a worktree creation whose fetch warned, then
   * the auto-prune's report — and a single-slot state made the second
   * silently erase the first before anyone read it. Head renders, `onDone`
   * shifts. */
  const [toasts, setToasts] = useState<readonly { seq: number; text: string }[]>([])
  const toastSeq = useRef(0)
  const pushToast = useCallback((text: string) => {
    toastSeq.current += 1
    const seq = toastSeq.current
    setToasts(queue => [...queue, { seq, text }])
  }, [])
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    // A moved session directory means a new repository context: any
    // half-open dialog belongs to the old one.
    setConfirm(null)
    setMenuOpen(false)
  }, [cwd])

  useEffect(() => {
    // The session started: the environment is fixed now, so a dialog staged
    // during the blank phase (a cutout or delete confirm) must not survive
    // into it — a keyboard-only send (no outside pointerdown to dismiss it)
    // can start the session while the dialog still floats. (Switches stage
    // no dialog — 签出 runs directly.)
    if (!session.blank) {
      setConfirm(null)
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
    pushToast(t('errorGeneric', { message }))
  }, [pushToast, t])

  /** Run one guarded confirm action: single-flight, toast on failure. On
   * success the confirm clears; the MENU closes unless `keepOpen` (the row
   * menu's rule: 原地动作 leave the picker up), and `onSettled` — the
   * flyout's success-only close hook — fires after both. */
  const runGuarded = useCallback(async (action: () => Promise<string | undefined>, keepOpen = false, onSettled?: () => void): Promise<void> => {
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
    if (!keepOpen) setMenuOpen(false)
    onSettled?.()
  }, [showError])

  /** In-place switch flow: POST /switch, then refetch the status. */
  const doSwitch = useCallback((branch: string, keepOpen = false) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestSwitch(cwd, branch)
    if (!result.ok) return result.error
    await refresh()
    return undefined
  }, keepOpen), [cwd, refresh, runGuarded])

  /** Create-branch flow: POST /branch (`from` + `checkout` split the three
   * shapes — see the wire docs), then refetch the status. ALWAYS keep-open:
   * the row menu is the only entry now, and the whole point of the menu is
   * acting on more rows afterwards; `onSettled` closes the create flyout
   * on success only. */
  const doCreateBranch = useCallback((name: string, from: string | undefined, checkout: boolean, onSettled: () => void) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestCreateBranch(cwd, name, from, checkout)
    if (!result.ok) return result.error
    await refresh()
    return undefined
  }, true, onSettled), [cwd, refresh, runGuarded])

  /** Rename-branch flow: POST /branch-rename (`git branch -m`, repository-
   * wide), then refetch the status — the chip label and the row follow the
   * new name. Keep-open + success-only `onSettled`, like the create. */
  const doRenameBranch = useCallback((name: string, newName: string, onSettled: () => void) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestRenameBranch(cwd, name, newName)
    if (!result.ok) return result.error
    await refresh()
    return undefined
  }, true, onSettled), [cwd, refresh, runGuarded])

  /** Delete-branch flow: POST /branch-delete (the SAFE `-d`; git refuses
   * unmerged commits and occupied branches with a 400 toast), then refetch
   * the status — the refreshed rows drop the row, the menu stays. */
  const doDeleteBranch = useCallback((name: string) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestDeleteBranch(cwd, name)
    if (!result.ok) return result.error
    await refresh()
    return undefined
  }, true), [cwd, refresh, runGuarded])

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
    pushToast(t('fetchDone'))
  }, [cwd, pushToast, refresh, showError, t])

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
    pushToast(result.updated ? t('updateDone', { branch: result.branch }) : t('updateUpToDate'))
  }, [cwd, pushToast, refresh, showError, t])

  /** Worktree-group flow: hop the session into the EXISTING worktree
   * directory. No git action, no confirm — the row menu's hop IS the jump
   * (a directory jump is reversible and touches nothing), and the owner's
   * adoptWorktree registers the folder and opens a blank session there. */
  const doAdoptWorktree = useCallback((path: string): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    adoptWorktree(path)
      .then(() => { setMenuOpen(false) })
      .catch((cause: unknown) => {
        showError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }, [adoptWorktree, showError])

  /** Worktree flow: POST /worktree (create-or-reuse, or cut out a new
   * branch under an explicit name), register the directory, hop sessions.
   * After the hop the lazy auto-prune fires (fire-and-forget — a slow
   * removal must not hold the confirm dialog open), and a failed
   * pre-create fetch surfaces as a toast without undoing the creation. */
  const doWorktree = useCallback((branch: string, cutout: boolean, name?: string) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = cutout
      ? await requestWorktreeCutout(cwd, branch, name)
      : await requestWorktree(cwd, branch)
    if (!result.ok) return result.error
    try {
      await adoptWorktree(result.path)
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
    if (result.fetchWarning !== undefined) {
      pushToast(t('fetchWarning', { message: result.fetchWarning }))
    }
    void pruneWorktrees?.(result.path).then((report) => {
      if (report === undefined) return
      if (report.removed.length > 0) {
        pushToast(report.failed.length > 0
          ? `${t('pruneDone', { n: report.removed.length })} ${t('pruneFailed', { n: report.failed.length })}`
          : t('pruneDone', { n: report.removed.length }))
      } else if (report.failed.length > 0) {
        pushToast(t('pruneFailed', { n: report.failed.length }))
      }
    }).catch(() => { /* a prune failure must not disturb the session flow */ })
    return undefined
  }), [adoptWorktree, pruneWorktrees, cwd, pushToast, runGuarded, t])

  const facts = repo.facts
  // The session sits in a linked worktree when its directory's toplevel is
  // NOT the main worktree entry — the trigger for the scoped menu (see
  // below) and for hiding the worktree toggle.
  const inLinkedWorktree = facts !== null
    && facts.worktrees.find(w => w.main)?.path !== facts.repoRoot
  const rows = useMemo(() => {
    if (facts === null) return []
    // A STARTED linked-worktree session shows nothing but its own branch:
    // the menu there is a position marker plus the fetch/update tools, not
    // a picker — every other branch lives behind the main checkout. A BLANK
    // one shows the full list for reading; its picks are answered with the
    // main-checkout hint (see onSelect).
    if (inLinkedWorktree && !session.blank) {
      const current = facts.branches.find(b => b.kind === 'local' && b.name === facts.currentBranch)
      return current === undefined
        ? []
        : [{
            name: current.name,
            kind: 'local' as const,
            ...current.ahead === undefined ? {} : { ahead: current.ahead },
            ...current.behind === undefined ? {} : { behind: current.behind },
          }]
    }
    return buildBranchRows(facts.branches, facts.worktrees, facts.currentBranch, inLinkedWorktree)
  }, [facts, inLinkedWorktree, session.blank])
  // Every already-taken LOCAL name feeds the new-branch namespaces (cutout
  // prefill and the duplicate checks): local rows and worktree rows alike
  // (a worktree row IS a checked-out branch), while a remote row is no
  // claim at all — a remote branch with a same-named local twin never
  // reaches the client (the host hides those rows).
  const localNames = useMemo(
    () => rows.filter(row => row.kind !== 'remote').map(row => row.name),
    [rows],
  )

  // Non-repo and still-loading directories render nothing at all.
  if (facts === null) return null

  const confirmLocalName = confirm === null ? '' : localBranchName(confirm.branch)
  // The cutout dialog carries an EDITABLE new-branch name (pre-filled with
  // the first free `<branch>-wt`); validated exactly like the create
  // flyout — git ref-name rules plus a duplicate check against the rows.
  const isCutout = confirm?.kind === 'worktree-cutout'
  const cutoutDraft = isCutout ? confirm.draft ?? '' : ''
  const cutoutIssue = isCutout ? branchNameIssue(cutoutDraft) : null
  const cutoutDuplicate = isCutout && cutoutIssue === null && localNames.includes(cutoutDraft)
  const cutoutValid = cutoutIssue === null && !cutoutDuplicate
  const cutoutHint = cutoutDuplicate
    ? t('menuNewBranchExists')
    : cutoutIssue !== null && cutoutIssue !== 'empty'
      ? t('menuNewBranchBad')
      : undefined
  // Reuse applies only to the plain create flow: a cutout always cuts a
  // fresh branch, so the current-branch confirm can never reuse.
  const existingWorktree = confirm === null || confirm.kind !== 'worktree'
    ? undefined
    : facts.worktrees.find(w => w.branch === confirmLocalName)

  /** One confirm bundle shared by the menu flyout and the standalone
   * dialog (whichever is showing). Switches stage NO dialog — 签出 runs
   * directly (keep-open); what remains is the destructive delete and the
   * worktree/cutout dialogs, the latter carrying the editable new-branch
   * name. Remote worktree picks keep the ask line SHORT and name the
   * branch on its own weight-500 line. */
  const confirmBundle = confirm === null ? null : {
    // The cutout dialog asks for the NAME, and names the base while it is
    // at it: the row that was right-clicked is gone by the time this
    // flyout replaces the menu, and "cut from which branch" is the half of
    // the action the input cannot express. The delete/worktree asks name
    // their consequence instead.
    ask: confirm.kind === 'worktree-cutout'
      ? t('cutoutFlyAsk', { branch: confirm.branch })
      : confirm.kind === 'delete'
        ? t('deleteBranchAsk', { branch: confirm.branch })
        : confirm.remote === true
          ? t('worktreeAskRemote')
          : t(existingWorktree !== undefined ? 'worktreeAskReuse' : 'worktreeAskNew', { branch: confirmLocalName }),
    ...confirm.remote === true ? { subject: confirm.branch } : {},
    confirmLabel: busy
      ? (confirm.kind === 'delete' ? t('deleteBranchBusy') : t('worktreeBusy'))
      : t('actionConfirm'),
    cancelLabel: t('actionCancel'),
    busy,
    // The cutout dialog carries an EDITABLE new-branch name (typed by
    // hand): the menu-open flyout renders the input from these fields —
    // same shape the standalone ChipConfirm spreads below.
    ...(confirm.kind === 'worktree-cutout'
      ? {
          draft: cutoutDraft,
          onDraftChange: (value: string) => { setConfirm(current => current?.kind === 'worktree-cutout' ? { ...current, draft: value } : current) },
          draftPlaceholder: t('menuNewBranchPlaceholder'),
          ...(cutoutValid ? {} : { draftInvalid: true }),
          ...(cutoutHint === undefined ? {} : { draftHint: cutoutHint }),
        }
      : {}),
    onConfirm: () => {
      if (confirm.kind === 'delete') {
        void doDeleteBranch(confirm.branch)
      } else if (confirm.kind === 'worktree-cutout' && !cutoutValid) {
        return
      } else {
        void doWorktree(confirm.branch, confirm.kind === 'worktree-cutout', confirm.draft)
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
      </span>
      <BranchMenu
        open={menuOpen}
        anchorRef={chipRef}
        rows={rows}
        currentBranch={facts.currentBranch}
        confirm={confirmBundle}
        canCreate={!inLinkedWorktree}
        canAdopt={session.blank}
        canWorktree={session.blank && !inLinkedWorktree}
        onWorktree={(branch) => {
          // The reuse/new/remote-twin confirm staged from a RIGHT-CLICKED
          // row: the anchor was staged by the menu; here we look the row up
          // for the remote wording and stage the dialog itself.
          const row = rows.find(r => r.name === branch)
          setConfirm({ kind: 'worktree', branch, remote: row?.kind === 'remote' })
        }}
        onCutWorktree={(base) => {
          // The cutout dialog staged from a RIGHT-CLICKED row: the base is
          // that row's branch (the current checkout included — the cut is
          // the isolated-worktree move). The new-branch name is typed by
          // hand (empty start, confirm disables until valid).
          setConfirm({ kind: 'worktree-cutout', branch: base })
        }}
        busy={busy}
        onCreate={(name, from, checkout, onSettled) => { void doCreateBranch(name, from, checkout, onSettled) }}
        onRename={(name, newName, onSettled) => { void doRenameBranch(name, newName, onSettled) }}
        onDelete={(branch) => {
          // The confirm flyout's anchor was staged by the row menu (it
          // knows the row element); here we only stage the dialog itself.
          setConfirm({ kind: 'delete', branch })
        }}
        onFetch={() => { void doFetch() }}
        fetchBusy={fetchBusy}
        onUpdate={() => { void doUpdate() }}
        updateBusy={updateBusy}
        onSelect={(branch) => {
          // Re-selecting the CURRENT branch is a plain close (worktree
          // creation lives in the row menu now — no mode bit reroutes
          // picks). Any other pick executes DIRECTLY — no confirm dialog on
          // the switch path (right-click 签出 and Enter are the same stroke,
          // keep-open so the picker stays up) — except a WORKTREE row: the
          // pick hops the session into that worktree directory (the menu
          // closes on success; the session moved).
          if (branch === facts.currentBranch) {
            setMenuOpen(false)
            return
          }
          // A linked-worktree session stages NO branch action — not plain
          // switches, not remote checkouts, not worktree hops. One hint
          // sends every pick back to the main checkout, where the worktree
          // verbs (and the whole action surface) live.
          if (inLinkedWorktree) {
            pushToast(t('mainRepoOnly'))
            return
          }
          const row = rows.find(r => r.name === branch)
          if (row?.kind === 'worktree' && row.path !== undefined) {
            doAdoptWorktree(row.path)
            return
          }
          // 签出, confirmation-free: an in-place `git switch` (remote rows
          // dwim their tracking twin), menu stays open.
          void doSwitch(branch, true)
        }}
        onClose={() => { setMenuOpen(false) }}
        t={t}
      />
      {confirmBundle !== null && !menuOpen && (
        <ChipConfirm
          anchorRef={chipRef}
          {...confirmBundle}
          {...isCutout ? { draft: cutoutDraft } : {}}
          {...isCutout
            ? { onDraftChange: (value: string) => { setConfirm(current => current?.kind === 'worktree-cutout' ? { ...current, draft: value } : current) } }
            : {}}
          draftPlaceholder={t('menuNewBranchPlaceholder')}
          {...isCutout && !cutoutValid ? { draftInvalid: true } : {}}
          {...cutoutHint === undefined ? {} : { draftHint: cutoutHint }}
        />
      )}
      {toasts[0] !== undefined && (
        <Toast
          key={toasts[0].seq}
          text={toasts[0].text}
          onDone={() => { setToasts(queue => queue.slice(1)) }}
        />
      )}
    </>
  )
}
