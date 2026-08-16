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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconBranchOutline16, Menu, Toast,
  type MenuEntry, type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { localBranchName } from '../normalize.ts'
import type { BranchEntry, RepoStatus, WorktreeEntry } from '../wire.ts'
import { fetchStatus, requestSwitch, requestWorktree } from './api.ts'
import { ConfirmPop } from './ConfirmPop.tsx'
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
  kind: 'switch' | 'worktree'
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

/**
 * Clamp a branch name for chip display: names up to 25 chars pass through;
 * longer ones show the first 24 chars plus an ellipsis.
 * @param branch - full branch name.
 */
function displayBranch(branch: string): string {
  return branch.length <= BRANCH_DISPLAY_MAX ? branch : `${branch.slice(0, BRANCH_DISPLAY_MAX - 1)}…`
}

/**
 * Assemble the branch menu: local branches only (remote branches are not
 * offered). A branch already checked out by a live worktree is disabled
 * while the worktree toggle is off (git refuses such a switch); with the
 * toggle on it is the reuse path, so it stays selectable. The selected row's
 * trailing check is the Menu's own selectedId affordance — no leading icon.
 */
function buildMenuEntries(
  branches: readonly BranchEntry[],
  worktrees: readonly WorktreeEntry[],
  currentBranch: string,
  worktreeMode: boolean,
  t: PropsLocale<'git-worktree'>['t'],
): MenuEntry[] {
  const occupied = new Set(worktrees.flatMap(w => w.branch === undefined ? [] : [w.branch]))
  const item = (branch: BranchEntry): MenuItem => ({
    id: branch.name,
    label: branch.name,
    disabled: branch.name !== currentBranch && !worktreeMode && occupied.has(localBranchName(branch.name)),
  })
  const local = branches.filter(b => b.kind === 'local')
  const entries: MenuEntry[] = [{ type: 'label', id: 'local', text: t('menuLocalBranches') }]
  entries.push(...local.map(item))
  return entries
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
    // during the blank phase must not survive into branch switching.
    if (!session.blank) setWorktreeMode(false)
  }, [session.blank])

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

  /** Worktree flow: POST /worktree, register the directory, hop sessions. */
  const doWorktree = useCallback((branch: string) => runGuarded(async () => {
    if (cwd === undefined) return 'no session directory'
    const result = await requestWorktree(cwd, branch)
    if (!result.ok) return result.error
    try {
      await adoptWorktree(result.path)
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
    return undefined
  }), [adoptWorktree, cwd, runGuarded])

  const facts = repo.facts
  const entries = useMemo(
    () => facts === null ? [] : buildMenuEntries(facts.branches, facts.worktrees, facts.currentBranch, worktreeMode, t),
    [facts, worktreeMode, t],
  )

  // Non-repo and still-loading directories render nothing at all.
  if (facts === null) return null

  const confirmLocalName = confirm === null ? '' : localBranchName(confirm.branch)
  const existingWorktree = confirm === null
    ? undefined
    : facts.worktrees.find(w => w.branch === confirmLocalName)

  return (
    <>
      <span className={css.dock}>
        <button
          ref={chipRef}
          type="button"
          className={css.chip}
          onClick={() => { setMenuOpen(open => !open) }}
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
              onClick={() => { setWorktreeMode(on => !on) }}
              title={t('worktreeToggle')}
            >
              <span className={css.box}>{worktreeMode ? <WorktreeCheck size={10} /> : null}</span>
              <span className={css.checkLabel}>{t('chipWorktree')}</span>
            </button>
          </>
        )}
      </span>
      <Menu
        open={menuOpen}
        anchor={null}
        portal
        getAnchorRect={() => chipRef.current?.getBoundingClientRect() ?? null}
        items={entries}
        selectedId={facts.currentBranch}
        onClose={() => { setMenuOpen(false) }}
        onSelect={(id) => {
          setMenuOpen(false)
          if (id === facts.currentBranch) return
          setConfirm({ kind: worktreeMode ? 'worktree' : 'switch', branch: id })
        }}
      />
      <ConfirmPop
        open={confirm !== null}
        anchorRef={chipRef}
        ask={confirm?.kind === 'worktree'
          ? t(existingWorktree !== undefined ? 'worktreeAskReuse' : 'worktreeAskNew', { branch: confirmLocalName })
          : t('switchAsk', { branch: confirm?.branch ?? '' })}
        confirmLabel={busy
          ? (confirm?.kind === 'worktree' ? t('worktreeBusy') : t('switchBusy'))
          : t('actionConfirm')}
        cancelLabel={t('actionCancel')}
        busy={busy}
        onConfirm={() => {
          if (confirm === null) return
          if (confirm.kind === 'worktree') void doWorktree(confirm.branch)
          else void doSwitch(confirm.branch)
        }}
        onCancel={() => { if (!busy) setConfirm(null) }}
        classes={{ card: css.popCard, ask: css.popAsk, actions: css.popActions }}
      />
      {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
    </>
  )
}
