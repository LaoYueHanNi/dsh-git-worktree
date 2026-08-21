/**
 * Host-side settings support: resolve the worktree storage root from the
 * settings section, and read the legacy settings file the pre-0.3 plugin
 * persisted on its own (~/.dsh/git-worktree/settings.json). The stored value
 * now lives in the dsh settings document under the `git-worktree` namespace;
 * the legacy file is read once at startup and its value migrated across (the
 * renamed file stays behind as a backup).
 */
/** The persisted document shape the pre-0.3 plugin read and wrote on its own. */
export interface LegacySettings {
    /** Worktree storage root; '' selected the default ~/.dsh/gitworktree. */
    rootDir: string;
}
/**
 * Resolve the effective worktree storage root: an explicit non-blank `rootDir`
 * wins; otherwise `$DSH_HOME/gitworktree` (a blank `$DSH_HOME` counts as
 * unset), else `~/.dsh/gitworktree`.
 * @param rootDir - the settings-resolved section value (absent/blank = default).
 * @param home - user home directory (`os.homedir()` seam).
 * @param envHome - `$DSH_HOME` environment value seam.
 * @returns an absolute directory path.
 */
export declare function resolveRootDir(rootDir: string | undefined, home: string, envHome: string | undefined): string;
/**
 * Reject a stored rootDir the plugin could not act on: a non-blank value that
 * is not an absolute path. Blank/absent means the default location and passes.
 * @param rootDir - the resolved section value.
 */
export declare function validateRootDir(rootDir: string | undefined): void;
/**
 * Decide what a legacy-file migration should store, if anything: the legacy
 * root only crosses over when it names a directory (blank kept the default,
 * which the section's absence already expresses) and the user layer has not
 * recorded its own choice (key presence, not a value comparison — an override
 * equal to the legacy value is still the user's own doing and must not be
 * rewritten).
 * @param legacy - the legacy file's stored value.
 * @param userLayer - the namespace's raw user layer, when one exists.
 * @returns the rootDir to write, or undefined to leave the section alone.
 */
export declare function planLegacyMigration(legacy: LegacySettings, userLayer: Record<string, unknown> | undefined): string | undefined;
/**
 * Load the legacy settings document.
 * @param file - absolute settings file path.
 * @returns the stored value, or the default when absent/unreadable/invalid.
 */
export declare function loadLegacySettings(file: string): Promise<LegacySettings>;
/** Resolve the legacy settings file location for a home directory. */
export declare function settingsFileOf(home: string): string;
/** The backup name a migrated legacy file is renamed to (never deleted). */
export declare function migratedFileOf(file: string): string;
