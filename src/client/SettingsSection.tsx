/**
 * WorktreeSettingsSection: the plugin's settings page — the storage-root
 * field bound to the plugin's own settings route. Every commit path is
 * automatic: picking a folder in the native dialog saves on the spot, and
 * manual edits save on Enter or blur, with a short inline status note —
 * there is no confirm button. Empty string selects the default
 * ~/.dsh/gitworktree.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconBranchOutline16, IconFolderClose16, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { isAbsoluteConfigPath } from '../normalize.ts'
import { fetchSettings, putSettings } from './api.ts'
import type { SettingsSectionInjected } from './slots.ts'
import css from './SettingsSection.module.css'

/** Section component props: injected picker + the locale seat. */
export type WorktreeSettingsSectionProps = SettingsSectionInjected & PropsLocale<'git-worktree'>

/**
 * The settings section body.
 * @param props - the native picker verb and the locale seat.
 */
export function WorktreeSettingsSection({ pickDirectory, t }: WorktreeSettingsSectionProps) {
  const [stored, setStored] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    void fetchSettings().then(result => {
      if (!live) return
      if (result.ok) {
        setStored(result.rootDir)
        setDraft(result.rootDir)
      } else {
        setError(result.error)
      }
    })
    return () => { live = false }
  }, [])

  /** Persist a root value — shared by every auto-save path. */
  const persist = useCallback(async (value: string) => {
    if (busy) return
    const trimmed = value.trim()
    if (trimmed !== '' && !isAbsoluteConfigPath(trimmed)) {
      setError(t('settingsRootDirInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    const result = await putSettings({ rootDir: trimmed })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStored(trimmed)
    setSavedFlash(true)
    setTimeout(() => { setSavedFlash(false) }, 1500)
  }, [busy, t])

  /** Manual edits commit on Enter, or on blur that leaves the row. */
  const commitDraft = useCallback(() => {
    if (stored !== null && draft.trim() !== stored) void persist(draft)
  }, [draft, persist, stored])

  /**
   * Native picker: a pick fills the draft AND saves it immediately. A
   * dismissal changes nothing.
   */
  const browse = useCallback(async () => {
    if (picking) return
    setPicking(true)
    try {
      const picked = await pickDirectory()
      if (picked !== null) {
        setDraft(picked)
        setError(null)
        await persist(picked)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPicking(false)
    }
  }, [persist, pickDirectory, picking])

  return (
    <div className={css.body}>
      <p className={css.description}>{t('settingsDescription')}</p>
      <label className={css.label} htmlFor="git-worktree-root-dir">{t('settingsRootDir')}</label>
      <div className={css.row} ref={rowRef}>
        <Input
          id="git-worktree-root-dir"
          icon={<IconBranchOutline16 size={12} />}
          value={draft}
          placeholder="~/.dsh/gitworktree"
          spellCheck={false}
          disabled={busy || picking}
          onChange={event => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') commitDraft()
          }}
          onBlur={event => {
            const next = event.relatedTarget
            if (next instanceof Node && rowRef.current?.contains(next)) return
            commitDraft()
          }}
        />
        <Button variant="outline" disabled={picking} onClick={() => { void browse() }} title={t('settingsBrowse')}>
          <IconFolderClose16 size={14} />
        </Button>
        {(busy || savedFlash) && (
          <span className={css.status}>{busy ? t('settingsSaving') : t('settingsSaved')}</span>
        )}
      </div>
      <p className={css.help}>{t('settingsRootDirHelp')}</p>
      {error !== null && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}
