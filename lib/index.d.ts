/**
 * dsh-git-worktree host half. Owns the settings document (~/.dsh/git-worktree/
 * settings.json) and — while a webServer service exists — the four HTTP
 * routes the browser half fetches. Headless profiles lose only the routes:
 * nothing else in the plugin has a browser dependency.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-git-worktree";
export declare const inject: never[];
/**
 * Plugin apply: load the settings document, then mount routes on any
 * webServer that comes and goes.
 * @param ctx - host cordis context.
 */
export declare function apply(ctx: Context): void;
