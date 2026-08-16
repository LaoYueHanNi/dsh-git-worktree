/**
 * Host-side settings persistence: one JSON file under ~/.dsh/git-worktree/
 * holding the worktree storage root. Atomic write (temp + rename); a missing
 * or invalid file resolves to defaults. The settings routes read and replace
 * the whole document.
 */
/** Persisted document shape. */
export interface StoredSettings {
    /** Worktree storage root; '' selects the default ~/.dsh/gitworktree. */
    rootDir: string;
}
/** The defaults a missing or invalid file resolves to. */
export declare const DEFAULT_SETTINGS: StoredSettings;
/**
 * Resolve the effective worktree storage root.
 * @param settings - stored settings value.
 * @param home - user home directory (`os.homedir()` seam).
 * @returns an absolute directory path.
 */
export declare function resolveRootDir(settings: StoredSettings, home: string): string;
/**
 * Load the stored settings document.
 * @param file - absolute settings file path.
 * @returns the stored value, or defaults when absent/unreadable/invalid.
 */
export declare function loadSettings(file: string): Promise<StoredSettings>;
/**
 * Atomically persist the settings document (temp file + rename), creating
 * the parent directory. An invalid rootDir (non-absolute, non-empty) rejects
 * before any write.
 * @param file - absolute settings file path.
 * @param value - the complete document to store.
 */
export declare function saveSettings(file: string, value: StoredSettings): Promise<void>;
/** Resolve the settings file location for a home directory. */
export declare function settingsFileOf(home: string): string;
