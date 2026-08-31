/**
 * Route logic as pure functions: query/body in, status+body out. The HTTP
 * shell (index.ts) owns req/res mechanics; everything testable lives here.
 */
import { type DirExists, type Exec } from './git.js';
import type { CreateBranchResult, CreateWorktreeResult, FetchResult, GroupWorkspacesResult, RepoStatus, RouteError, SwitchResult, UpdateResult } from './wire.js';
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
    body: RepoStatus | CreateWorktreeResult | SwitchResult | CreateBranchResult | FetchResult | UpdateResult | GroupWorkspacesResult | RouteError;
}
/**
 * POST /group — git belonging facts for a batch of workspace directories.
 * Deduplicates, validates, probes in bounded batches, and answers 200 with
 * per-path facts (null for non-repositories); a repository-wide git failure
 * is a per-path null, never a 500 — the sidebar must degrade to flat, not
 * error out.
 * @param deps - host dependencies.
 * @param body - parsed request body: `{ paths }`.
 */
export declare function handleGroupWorktrees(deps: RouteDeps, body: unknown): Promise<RouteOutcome>;
/**
 * GET /status 鈥?repository facts for one directory.
 * @param deps - host dependencies.
 * @param path - absolute directory the workspace reports.
 */
export declare function handleStatus(deps: RouteDeps, path: string | undefined): Promise<RouteOutcome>;
/**
 * POST /worktree 鈥?create or reuse the worktree for a branch, then report the
 * directory so the client can register it as a workspace. With `cutout: true`
 * the branch is the CURRENT checkout (occupied by the main worktree, so git
 * refuses to add it): a new branch is cut out of it (`<branch>-wt`, first
 * free `-wt<N>` suffix) and isolated in the fresh worktree instead.
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
/**
 * POST /branch 鈥?create a NEW branch from the queried directory's current
 * checkout (whatever its HEAD points at, detached included) and check it out
 * in place. Git validates the name; the client pre-flights the same rules
 * and only sends names it already accepts.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export declare function handleCreateBranch(deps: RouteDeps, body: unknown): Promise<RouteOutcome>;
/**
 * POST /fetch 鈥?sync remote-tracking refs for the repository: fetch every
 * remote and prune tracking branches the remotes no longer carry. Pure
 * metadata — the working tree and the current checkout are untouched; the
 * client refetches /status afterwards for the fresh branch list.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export declare function handleFetch(deps: RouteDeps, body: unknown): Promise<RouteOutcome>;
/**
 * POST /update 鈥?update the CURRENT checkout: fetch every remote, then
 * fast-forward the branch checked out by the queried directory to its
 * upstream. Divergence, a missing upstream, and conflicting working-tree
 * changes all surface as 400 envelopes carrying git's own explanation.
 * @param deps - host dependencies.
 * @param body - parsed request body.
 */
export declare function handleUpdate(deps: RouteDeps, body: unknown): Promise<RouteOutcome>;
