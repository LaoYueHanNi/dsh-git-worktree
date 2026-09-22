/**
 * Host-side settings support: resolve the worktree storage root from the
 * settings section, and read the legacy settings file the pre-0.3 plugin
 * persisted on its own (~/.dsh/git-worktree/settings.json). The stored value
 * now lives in the dsh settings document under the `git-worktree` namespace;
 * the legacy file is read once at startup and its value migrated across (the
 * renamed file stays behind as a backup).
 */

import { join } from 'node:path'
import { isAbsoluteConfigPath } from './normalize.js'

/**
 * Resolve the effective worktree storage root: an explicit non-blank `rootDir`
 * wins; otherwise `$DSH_HOME/gitworktree` (a blank `$DSH_HOME` counts as
 * unset), else `~/.dsh/gitworktree`.
 * @param rootDir - the settings-resolved section value (absent/blank = default).
 * @param home - user home directory (`os.homedir()` seam).
 * @param envHome - `$DSH_HOME` environment value seam.
 * @returns an absolute directory path.
 */
export function resolveRootDir(rootDir: string | undefined, home: string, envHome: string | undefined): string {
  const configured = rootDir?.trim()
  if (configured !== undefined && configured !== '') return configured
  const base = typeof envHome === 'string' && envHome.trim() !== '' ? envHome : join(home, '.dsh')
  return join(base, 'gitworktree')
}

/**
 * Reject a stored rootDir the plugin could not act on: a non-blank value that
 * is not an absolute path. Blank/absent means the default location and passes.
 * @param rootDir - the resolved section value.
 */
export function validateRootDir(rootDir: string | undefined): void {
  if (rootDir === undefined) return
  const trimmed = rootDir.trim()
  if (trimmed === '') return
  if (!isAbsoluteConfigPath(trimmed)) {
    throw new Error(`rootDir "${rootDir}" is not an absolute path`)
  }
}
