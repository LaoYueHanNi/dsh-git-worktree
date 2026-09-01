/**
 * Form over the `git-worktree` settings namespace.
 *
 * `rootDir` is staged: a settings write is a durable, revision-fenced
 * document mutation, so the control stages what the user picks and commits
 * it only on save. The field shows its effective value (user layer over
 * composition layer over schema default) and whether the user layer carries
 * it — key presence, not a value comparison, marks an override.
 *
 * `groupSidebar` writes through immediately (the sidebar seat subscribes to
 * the same scope). The card snapshot flips the value and raises
 * `groupingPending` before the write crosses the wire, so the checkbox and
 * spinner can paint; pending stays up until `afterGroupSidebarWrite`
 * reports the seat has swapped (not merely until `scope.set` resolves).
 *
 * Self-contained on purpose: the client bundle-purity rule forbids value
 * imports across plugins, so this package stages and fences its own form
 * (and its own snapshot store) rather than importing another plugin's model.
 *
 * @module git-worktree/client/card-form
 */

// Host 0.1.2 homes the settings scope contract here (settings-contract.ts);
// until the alpha.3 adaptation this type was read from the dead
// dsh-client-runtime's identical shape.
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The field this card edits. */
export const ROOT_FIELD = 'rootDir'

/** The resolved user-facing section this card edits. */
export interface SectionValue {
  /** Worktree storage root; absent selects `$DSH_HOME/gitworktree`. */
  rootDir?: string
  /** Whether the sidebar groups same-repository workspaces; absent = on. */
  groupSidebar?: boolean
}

/**
 * Minimal observable snapshot source: the stable-reference discipline the
 * shell's stores follow (same snapshot object until the fact moves), with
 * nothing the single-field form does not use.
 */
export interface CardStore {
  /** @returns the current snapshot (stable reference until the next change). */
  getSnapshot(): CardState
  /** @param listener - invoked after each snapshot change. @returns the disposer. */
  subscribe(listener: () => void): () => void
  /** @param next - the new snapshot; replaces the reference only on a real change. */
  set(next: CardState): void
}

/** What the git-worktree settings card renders. */
export interface CardState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Draft text ('' marks the inherited/default location). */
  rootDir: string
  /** Whether saving the field would leave a user-layer entry. */
  overridden: boolean
  /** Whether the form holds an edit that a save would write. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  /** Resolved sidebar-grouping switch (user layer over the default on). */
  groupSidebar: boolean
  /** True while a grouping-switch write (and the seat swap it triggers) is in flight. */
  groupingPending: boolean
}

/** The form actions the card's slot entry injects. */
export interface CardActions {
  /** Stage draft text for the root field. */
  editRoot: (text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the default location. */
  clearRoot: () => void
  /** Write the staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop the staged edit. */
  discard: () => void
  /** Persist the sidebar-grouping switch (takes effect immediately). */
  setGroupSidebar: (value: boolean) => void
}

/**
 * Stages the settings edit over the `git-worktree` scope.
 *
 * The form publishes through a snapshot store because the slot component
 * reads through a snapshot selector while both the scope and the local draft
 * change underneath; every projection is rebuilt from the two together. The
 * root field is staged only when the user touched it, so a save writes a
 * sparse patch and never restates fields it did not see. The grouping switch
 * is not staged: a set optimistic-publishes, yields a frame so the spinner
 * can paint, then writes; pending holds until the seat callback settles.
 */
export class CardForm {
  private snapshotValue: CardState
  private readonly listeners = new Set<() => void>()
  private draft: string | undefined
  private saving = false
  private failed = false
  private groupingPending = false
  private groupingDraft: boolean | undefined

  /**
   * @param scope - the bound settings scope for the `git-worktree` namespace.
   * @param afterGroupSidebarWrite - awaited after the setting lands, until
   *   the sidebar seat has actually swapped (facts in on enable, native
   *   paint on disable). Absent in unit tests that only cover the write.
   */
  constructor(
    private readonly scope: SettingsScope<SectionValue>,
    private readonly afterGroupSidebarWrite?: (enabled: boolean) => Promise<void>,
  ) {
    this.snapshotValue = this.project()
    scope.subscribe(() => { this.publish() })
  }

  /** @returns the store the card's component reads through its bound selector. */
  bind(): CardStore {
    return {
      getSnapshot: () => this.snapshotValue,
      subscribe: (listener) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      set: (next) => { this.store(next) },
    }
  }

  /** @returns the edit, clear, save, discard, and grouping-switch actions bound to this form. */
  actions(): CardActions {
    return {
      editRoot: (text) => {
        this.draft = text
        this.failed = false
        this.publish()
      },
      clearRoot: () => {
        this.draft = ''
        this.failed = false
        this.publish()
      },
      // Returns the save's promise (assignable to the void action slot) so
      // callers that care — tests — can await settlement.
      save: () => this.save(),
      discard: () => {
        if (this.draft === undefined && !this.failed) return
        this.draft = undefined
        this.failed = false
        this.publish()
      },
      setGroupSidebar: (value) => this.setGroupSidebar(value),
    }
  }

  /**
   * Flip the grouping switch immediately, then persist.
   *
   * `scope.set` only stores the document; the visible sidebar swap (inject
   * + `/group` facts, or dispose + native paint) happens after. Pending
   * stays up until that callback settles so the spinner matches what the
   * user sees, not the write round-trip.
   */
  private async setGroupSidebar(value: boolean): Promise<void> {
    if (this.groupingPending) return
    if (value === this.effectiveGroupSidebar()) return
    this.groupingPending = true
    this.groupingDraft = value
    this.publish()
    await yieldForPaint()
    try {
      await this.scope.set('groupSidebar', value)
      if (this.afterGroupSidebarWrite !== undefined) await this.afterGroupSidebarWrite(value)
    } finally {
      this.groupingPending = false
      this.groupingDraft = undefined
      this.publish()
    }
  }

  /** Resolved grouping switch, preferring an in-flight optimistic draft. */
  private effectiveGroupSidebar(): boolean {
    return this.groupingDraft ?? this.scope.getSnapshot().value?.groupSidebar ?? true
  }

  /**
   * Write the staged edit, then re-seed from what the Host accepted.
   *
   * The Host is the only authority on acceptance — an empty draft clears the
   * field, anything else stores the trimmed text (so blanking the control and
   * saving is the same gesture as clearing it). A save that did not land
   * keeps its draft so the user can correct it instead of retyping.
   */
  private async save(): Promise<void> {
    if (this.draft === undefined || this.saving) return
    // Snapshot the intended write: a keystroke mid-await must not change what
    // this save commits.
    const intended = this.draft.trim()
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      if (intended === '') await this.scope.unset(ROOT_FIELD)
      else await this.scope.set(ROOT_FIELD, intended)
      // Read back: the Host's validator owns the constraints no schema
      // expresses, so acceptance is judged from the stored layers.
      if (intended === '' ? this.storedRoot() : this.storedRootValue() !== intended) {
        landed = false
      }
    } catch (_settingsWriteFailure) {
      landed = false
    }
    if (landed) this.draft = undefined
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /** The raw user layer narrowed to a record; the wire answer is `unknown`. */
  private userLayer(): Record<string, unknown> | undefined {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null ? user as Record<string, unknown> : undefined
  }

  /** Whether the user layer carries the root field. */
  private storedRoot(): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, ROOT_FIELD)
  }

  /** The raw user-layer value of the root field. */
  private storedRootValue(): unknown {
    return this.userLayer()?.[ROOT_FIELD]
  }

  /** The resolved (draft-free) text of the field; '' means inherited. */
  private effectiveRoot(): string {
    const value = this.scope.getSnapshot().value?.[ROOT_FIELD]
    return typeof value === 'string' ? value : ''
  }

  private project(): CardState {
    const snapshot = this.scope.getSnapshot()
    const draft = this.draft ?? this.effectiveRoot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      rootDir: draft,
      // A staged edit answers for itself, so the override badge previews the
      // save rather than reporting a state the pending edit contradicts.
      overridden: this.draft !== undefined ? this.draft.trim() !== '' : this.storedRoot(),
      dirty: this.draft !== undefined && this.draft !== this.effectiveRoot(),
      saving: this.saving,
      failed: this.failed,
      groupSidebar: this.effectiveGroupSidebar(),
      groupingPending: this.groupingPending,
    }
  }

  /** Replace the snapshot reference and notify, only when the fact moved. */
  private store(next: CardState): void {
    if (next === this.snapshotValue) return
    this.snapshotValue = next
    for (const listener of this.listeners) listener()
  }

  private publish(): void {
    this.store(this.project())
  }
}

/** Yield until after the next paint (rAF), or a macrotask when rAF is absent (tests). */
function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { resolve() })
      return
    }
    setTimeout(resolve, 0)
  })
}
