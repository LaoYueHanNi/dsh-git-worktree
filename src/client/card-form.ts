/**
 * Form over the `git-worktree` settings namespace.
 *
 * `rootDir` is READ-ONLY: it names the historical central storage location
 * (kept for the worktrees already living there — new ones are created inside
 * their repository), so the field reports its effective value and whether
 * the user layer carries it, but stages no edit.
 *
 * `keepWorktrees` is staged: a settings write is a durable, revision-fenced
 * document mutation, so the control stages what the user types and commits
 * it only on save.
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
export const COPY_FILES_FIELD = 'postCreateCopyFiles'

/** The resolved user-facing section this card edits. */
export interface SectionValue {
  /** Worktree storage root; absent selects `$DSH_HOME/gitworktree`. */
  rootDir?: string
  /** Sync the remotes before creating a worktree; absent = off. */
  fetchBeforeCreate?: boolean
  /** Prune stale worktrees lazily after each creation; absent = off. */
  autoPruneWorktrees?: boolean
  /** Global cap the lazy prune trims down to; absent = 30. */
  keepWorktrees?: number
  /** Post-create configuration files to copy when .worktreeinclude is absent. */
  postCreateCopyFiles?: string[]
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

/** Which write-through switch failed to persist, if any. Unlike the staged
 * root field these flip immediately, so a rejected write leaves the control
 * silently snapping back — the card needs to say which one did not take. */
export type SwitchField = 'fetchBeforeCreate' | 'autoPruneWorktrees'

/** What the git-worktree settings card renders. */
export interface CardState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Read-only legacy storage root as the scope resolves it ('' = the
   * inherited default; the card prefers the Host-spelled absolute path). */
  rootDir: string
  /** Whether the user layer carries the root field (a custom location). */
  overridden: boolean
  /** Whether the form holds an edit that a save would write. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
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
  /** The write-through switch whose last flip did not persist; null once a
   * later flip succeeds. The card renders a retry note beside it. */
  switchFailed: SwitchField | null
  /** The post-create copy files field as MULTI-LINE TEXT (one relative path per line). */
  postCreateCopyFilesText: string
}

/** The form actions the card's slot entry injects. */
export interface CardActions {
  /** Write the staged keep-cap and copy-files edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop the staged edits. */
  discard: () => void
  /** Persist the fetch-before-create switch (takes effect immediately). */
  setFetchBeforeCreate: (value: boolean) => void
  /** Persist the auto-prune switch (takes effect immediately). */
  setAutoPruneWorktrees: (value: boolean) => void
  /** Stage draft text for the keep-cap field (validated on save). */
  editKeepWorktrees: (text: string) => void
  /** Stage draft text for the post-create copy files field. */
  editPostCreateCopyFiles: (text: string) => void
}

/**
 * Stages the settings edit over the `git-worktree` scope.
 *
 * The form publishes through a snapshot store because the slot component
 * reads through a snapshot selector while both the scope and the local draft
 * change underneath; every projection is rebuilt from the two together.
 */
export class CardForm {
  private snapshotValue: CardState
  private readonly listeners = new Set<() => void>()
  private keepDraft: string | undefined
  private copyFilesDraft: string | undefined
  private saving = false
  private failed = false
  private switchFailed: SwitchField | null = null

  /**
   * @param scope - the bound settings scope for the `git-worktree` namespace.
   */
  constructor(private readonly scope: SettingsScope<SectionValue>) {
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
      // Returns the save's promise (assignable to the void action slot) so
      // callers that care — tests — can await settlement.
      save: () => this.save(),
      discard: () => {
        if (this.keepDraft === undefined && this.copyFilesDraft === undefined && !this.failed) return
        this.keepDraft = undefined
        this.copyFilesDraft = undefined
        this.failed = false
        this.publish()
      },
      setFetchBeforeCreate: (value) => this.setSimpleFlag('fetchBeforeCreate', value),
      setAutoPruneWorktrees: (value) => this.setSimpleFlag('autoPruneWorktrees', value),
      editKeepWorktrees: (text) => {
        this.keepDraft = text
        this.failed = false
        this.publish()
      },
      editPostCreateCopyFiles: (text) => {
        this.copyFilesDraft = text
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

  /** Parse multi-line text into array of clean relative paths. */
  private parseCopyFiles(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line !== '')
  }

  /** Serialized stored copy files list (newline-joined). */
  private storedCopyFilesText(): string {
    const list = this.scope.getSnapshot().value?.[COPY_FILES_FIELD]
    return Array.isArray(list) ? list.join('\n') : ''
  }

  /** The copy files text as user sees it: live draft, else stored value. */
  private effectiveCopyFilesText(): string {
    return this.copyFilesDraft ?? this.storedCopyFilesText()
  }

  /**
   * Flip a write-through switch immediately, then persist.
   *
   * A rejected write is CAUGHT, not propagated: the card invokes these from
   * a checkbox `onChange` that discards the promise, so an escaping
   * rejection would be an unhandled one AND would leave the control
   * snapping back with no explanation. The failure is recorded instead and
   * the card renders a retry note beside the switch.
   */
  private async setSimpleFlag(field: 'fetchBeforeCreate' | 'autoPruneWorktrees', value: boolean): Promise<void> {
    const current = this.scope.getSnapshot().value?.[field] ?? false
    if (value === current) return
    try {
      await this.scope.set(field, value)
      if (this.switchFailed === field) this.switchFailed = null
    } catch (_switchWriteFailure) {
      this.switchFailed = field
    }
    this.publish()
  }

  /**
   * Write the staged keep-cap and copy-files edits, then re-seed from what the Host
   * accepted.
   *
   * The Host is the only authority on acceptance — the keep draft must
   * parse to an integer >= 1 before the save may run. A save that did not
   * land keeps its draft so the user can correct it instead of retyping.
   */
  private async save(): Promise<void> {
    if ((this.keepDraft === undefined && this.copyFilesDraft === undefined) || this.saving) return
    let intendedKeep: number | undefined
    if (this.keepDraft !== undefined) {
      intendedKeep = this.parseKeep(this.keepDraft)
      if (intendedKeep === undefined || intendedKeep < 1) return
    }
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      if (intendedKeep !== undefined) {
        await this.scope.set(KEEP_FIELD, intendedKeep)
        if (this.userLayer()?.[KEEP_FIELD] !== intendedKeep) {
          landed = false
        }
      }
      if (this.copyFilesDraft !== undefined) {
        const parsedList = this.parseCopyFiles(this.copyFilesDraft)
        await this.scope.set(COPY_FILES_FIELD, parsedList)
      }
    } catch (_settingsWriteFailure) {
      landed = false
    }
    if (landed) {
      this.keepDraft = undefined
      this.copyFilesDraft = undefined
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

  /** The resolved (draft-free) text of the field; '' means inherited. */
  private effectiveRoot(): string {
    const value = this.scope.getSnapshot().value?.[ROOT_FIELD]
    return typeof value === 'string' ? value : ''
  }

  private project(): CardState {
    const snapshot = this.scope.getSnapshot()
    const keepText = this.effectiveKeepText()
    const keepParsed = this.parseKeep(keepText)
    const copyFilesText = this.effectiveCopyFilesText()
    const keepDirty = this.keepDraft !== undefined && this.keepDraft !== String(this.scope.getSnapshot().value?.[KEEP_FIELD] ?? 30)
    const copyFilesDirty = this.copyFilesDraft !== undefined && this.copyFilesDraft !== this.storedCopyFilesText()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      rootDir: this.effectiveRoot(),
      overridden: this.storedRoot(),
      dirty: keepDirty || copyFilesDirty,
      saving: this.saving,
      failed: this.failed,
      fetchBeforeCreate: this.scope.getSnapshot().value?.fetchBeforeCreate ?? false,
      autoPruneWorktrees: this.scope.getSnapshot().value?.autoPruneWorktrees ?? false,
      keepWorktreesText: keepText,
      keepWorktreesValid: keepParsed !== undefined && keepParsed >= 1,
      switchFailed: this.switchFailed,
      postCreateCopyFilesText: copyFilesText,
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
