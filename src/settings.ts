/**
 * Host-side settings persistence: one JSON file under ~/.dsh/git-worktree/
 * holding the worktree storage root. Atomic write (temp + rename); a missing
 * or invalid file resolves to defaults. The settings routes read and replace
 * the whole document.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isAbsoluteConfigPath } from './normalize.js'

/** Persisted document shape. */
export interface StoredSettings {
  /** Worktree storage root; '' selects the default ~/.dsh/gitworktree. */
  rootDir: string
}

/** The defaults a missing or invalid file resolves to. */
export const DEFAULT_SETTINGS: StoredSettings = { rootDir: '' }

/**
 * Resolve the effective worktree storage root.
 * @param settings - stored settings value.
 * @param home - user home directory (`os.homedir()` seam).
 * @returns an absolute directory path.
 */
export function resolveRootDir(settings: StoredSettings, home: string): string {
  const configured = settings.rootDir.trim()
  return configured === '' ? join(home, '.dsh', 'gitworktree') : configured
}

/**
 * Load the stored settings document.
 * @param file - absolute settings file path.
 * @returns the stored value, or defaults when absent/unreadable/invalid.
 */
export async function loadSettings(file: string): Promise<StoredSettings> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return DEFAULT_SETTINGS
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS
    const rootDir = (parsed as Record<string, unknown>).rootDir
    return typeof rootDir === 'string' ? { rootDir } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Atomically persist the settings document (temp file + rename), creating
 * the parent directory. An invalid rootDir (non-absolute, non-empty) rejects
 * before any write.
 * @param file - absolute settings file path.
 * @param value - the complete document to store.
 */
export async function saveSettings(file: string, value: StoredSettings): Promise<void> {
  const trimmed = value.rootDir.trim()
  if (trimmed !== '' && !isAbsoluteConfigPath(trimmed)) {
    throw new Error(`rootDir "${value.rootDir}" is not an absolute path`)
  }
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, `${JSON.stringify({ rootDir: trimmed }, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/** Resolve the settings file location for a home directory. */
export function settingsFileOf(home: string): string {
  return join(home, '.dsh', 'git-worktree', 'settings.json')
}
