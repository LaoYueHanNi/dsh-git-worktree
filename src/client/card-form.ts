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

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The fields this card edits. */
export const ROOT_FIELD = 'rootDir'
export const KEEP_FIELD = 'keepWorktrees'

/** The resolved user-facing section this card edits. */
export interface SectionValue {
  /** Worktree storage root; absent selects `$DSH_HOME/gitworktree`. */
  rootDir?: string
  /** Whether the sidebar groups same-repository workspaces; absent = on. */
  groupSidebar?: boolean
  /** Sync the remotes before creating a worktree; absent = off. */
  fetchBeforeCreate?: boolean
  /** Prune stale worktrees lazily after each creation; absent = off. */
  autoPruneWorktrees?: boolean
  /** Global cap the lazy prune trims down to; absent = 30. */
  keepWorktrees?: number
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
  /** Resolved fetch-before-create switch (user layer over the default off). */
  fetchBeforeCreate: boolean
  /** Resolved auto-prune switch (user layer over the default off). */
  autoPruneWorktrees: boolean
  /** The keep-cap field as TEXT: the effective value, or the live draft. */
  keepWorktreesText: string
  /** True when the keep field (draft or effective) is a usable integer >= 1.
   * An invalid DRAFT disables saving; an invalid STORED value (host-side
   * hand edit) just disables the prune's usefulness, not the card. */
  keepWorktreesValid: boolean
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
  /** Persist the fetch-before-create switch (takes effect immediately). */
  setFetchBeforeCreate: (value: boolean) => void
  /** Persist the auto-prune switch (takes effect immediately). */
  setAutoPruneWorktrees: (value: boolean) => void
  /** Stage draft text for the keep-cap field (validated on save). */
  editKeepWorktrees: (text: string) => void
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
  private keepDraft: string | undefined
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

  /** @returns the edit, clear, save, discard, and switch actions bound to this form. */
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
        if (this.draft === undefined && this.keepDraft === undefined && !this.failed) return
        this.draft = undefined
        this.keepDraft = undefined
        this.failed = false
        this.publish()
      },
      setGroupSidebar: (value) => this.setGroupSidebar(value),
      setFetchBeforeCreate: (value) => this.setSimpleFlag('fetchBeforeCreate', value),
      setAutoPruneWorktrees: (value) => this.setSimpleFlag('autoPruneWorktrees', value),
      editKeepWorktrees: (text) => {
        this.keepDraft = text
        this.failed = false
        this.publish()
      },
    }
  }

  /** Strict integer parse for the staged keep cap; anything else is unusable. */
  private parseKeep(text: string): number | undefined {
    if (!/^-?\d+$/.test(text.trim())) return undefined
    return Number(text.trim())
  }

  /** The keep cap as the user sees it: the live draft, else the stored value
   * over the shipped default. */
  private effectiveKeepText(): string {
    const value = this.scope.getSnapshot().value?.[KEEP_FIELD]
    return this.keepDraft ?? String(value ?? 30)
  }

  /**
   * Flip a write-through switch with no seat swap to wait for (unlike the
   * grouping switch): optimistic publish, persist, done.
   */
  private async setSimpleFlag(field: 'fetchBeforeCreate' | 'autoPruneWorktrees', value: boolean): Promise<void> {
    const current = this.scope.getSnapshot().value?.[field] ?? false
    if (value === current) return
    await this.scope.set(field, value)
    this.publish()
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
   * Write the staged edits (root text and/or keep cap), then re-seed from
   * what the Host accepted.
   *
   * The Host is the only authority on acceptance — an empty root draft
   * clears the field, anything else stores the trimmed text (so blanking the
   * control and saving is the same gesture as clearing it); the keep draft
   * must parse to an integer >= 1 before the save may run. A save that did
   * not land keeps its drafts so the user can correct them instead of
   * retyping.
   */
  private async save(): Promise<void> {
    if ((this.draft === undefined && this.keepDraft === undefined) || this.saving) return
    // Snapshot the intended write: a keystroke mid-await must not change what
    // this save commits.
    const intendedRoot = this.draft?.trim()
    const intendedKeep = this.keepDraft !== undefined ? this.parseKeep(this.keepDraft) : undefined
    if (this.keepDraft !== undefined && (intendedKeep === undefined || intendedKeep < 1)) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      if (intendedRoot === '') await this.scope.unset(ROOT_FIELD)
      else if (intendedRoot !== undefined) await this.scope.set(ROOT_FIELD, intendedRoot)
      if (intendedKeep !== undefined) await this.scope.set(KEEP_FIELD, intendedKeep)
      // Read back: the Host's validator owns the constraints no schema
      // expresses, so acceptance is judged from the stored layers.
      if (intendedRoot !== undefined && (intendedRoot === '' ? this.storedRoot() : this.storedRootValue() !== intendedRoot)) {
        landed = false
      }
      if (intendedKeep !== undefined && this.userLayer()?.[KEEP_FIELD] !== intendedKeep) {
        landed = false
      }
    } catch (_settingsWriteFailure) {
      landed = false
    }
    if (landed) {
      if (intendedRoot !== undefined) this.draft = undefined
      if (intendedKeep !== undefined) this.keepDraft = undefined
    }
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
    const keepText = this.effectiveKeepText()
    const keepParsed = this.parseKeep(keepText)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      rootDir: draft,
      // A staged edit answers for itself, so the override badge previews the
      // save rather than reporting a state the pending edit contradicts.
      overridden: this.draft !== undefined ? this.draft.trim() !== '' : this.storedRoot(),
      dirty: (this.draft !== undefined && this.draft !== this.effectiveRoot())
        || (this.keepDraft !== undefined && this.keepDraft !== String(this.scope.getSnapshot().value?.[KEEP_FIELD] ?? 30)),
      saving: this.saving,
      failed: this.failed,
      groupSidebar: this.effectiveGroupSidebar(),
      groupingPending: this.groupingPending,
      fetchBeforeCreate: this.scope.getSnapshot().value?.fetchBeforeCreate ?? false,
      autoPruneWorktrees: this.scope.getSnapshot().value?.autoPruneWorktrees ?? false,
      keepWorktreesText: keepText,
      keepWorktreesValid: keepParsed !== undefined && keepParsed >= 1,
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
