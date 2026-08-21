/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */
import { type DirExists, type Exec } from './git.js';
import type { CreateWorktreeResult, RepoStatus, RouteError, SwitchResult } from './wire.js';
/** Everything the handlers need from the host half. */
export interface RouteDeps {
    exec: Exec;
    /** The settings-resolved rootDir (absent/blank = the default location). */
    sectionRootDir: () => string | undefined;
    /** User home directory seam. */
    home: () => string;
    /** `$DSH_HOME` environment value seam. */
    envHome: () => string | undefined;
    /** Worktree-registration existence seam (tests substitute). */
    dirExists?: DirExists;
}
/** One route outcome: HTTP status plus the JSON body. */
export interface RouteOutcome {
    status: number;
    body: RepoStatus | CreateWorktreeResult | SwitchResult | RouteError;
}
/**
 * GET /status 鈥?repository facts for one directory.
 * @param deps - host dependencies.
 * @param path - absolute directory the workspace reports.
 */
export declare function handleStatus(deps: RouteDeps, path: string | undefined): Promise<RouteOutcome>;
/**
 * POST /worktree 鈥?create or reuse the worktree for a branch, then report the
 * directory so the client can register it as a workspace.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export declare function handleCreateWorktree(deps: RouteDeps, body: unknown): Promise<RouteOutcome>;
/**
 * POST /switch 鈥?in-place branch switch of the main checkout.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export declare function handleSwitch(deps: RouteDeps, body: unknown): Promise<RouteOutcome>;
