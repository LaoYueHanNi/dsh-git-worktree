/**
 * dsh-git-worktree host half. Owns the worktree storage-root settings section
 * (the `git-worktree` namespace in the dsh settings document, registered
 * through SettingsProvider.installSection with the composition entry as its
 * base
 * layer) and — while a webServer service exists — the HTTP routes the browser
 * half fetches. A stored root edit takes effect live: the routes read the
 * section source per request, so no restart and no route re-registration.
 *
 * The legacy ~/.dsh/git-worktree/settings.json value migrates into the
 * namespace once, when a settings service first attaches and the user layer
 * has recorded no choice of its own; the renamed file stays behind as a
 * backup. Headless profiles lose only the routes: nothing else in the plugin
 * has a browser dependency.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-git-worktree";
export declare const inject: never[];
export interface Config {
    /** Worktree storage root; defaults to `$DSH_HOME/gitworktree` (`~/.dsh/gitworktree`). */
    rootDir?: string;
    /** Sidebar git grouping on/off; absent = on (the composition-entry layer's default). */
    groupSidebar?: boolean;
}
/** Reject stale or misspelled config keys before defaults can hide them. */
export declare function validateConfig(config: Config): void;
/** The settings namespace this plugin serves; its browser card spells the same string. */
export declare const GIT_WORKTREE_NS = "git-worktree";
/** The settings-facing subset of the config: the worktree storage root and the sidebar grouping switch. */
export interface SectionConfig {
    /** Worktree storage root; absent/blank selects `$DSH_HOME/gitworktree`. */
    rootDir?: string;
    /** Whether the sidebar groups same-repository workspaces; absent = on. */
    groupSidebar?: boolean;
}
/** Schema resolving the `git-worktree` settings section. */
export declare const sectionSchema: z<SectionConfig>;
/** The section-shaped view of a config: absent keys stay absent (`exactOptionalPropertyTypes`). */
export declare function sectionOf(config: Config): SectionConfig;
/**
 * Plugin apply: install the settings section, migrate any legacy stored root
 * into it, then mount routes on any webServer that comes and goes.
 * @param ctx - host cordis context.
 * @param config - the composition entry config (the section's base layer).
 */
export declare function apply(ctx: Context, config?: Config): void;
