/**
 * Shared wire contract between the host half (HTTP routes under
 * `/plugin/git-worktree`) and the browser half (chip + plugin settings card).
 * Zero runtime dependencies: constants and types only, imported by both
 * builds.
 */
/** Absolute pathname prefix every route of this plugin lives under. */
export const ROUTE_PREFIX = '/plugin/git-worktree';
/** GET ROUTE_PREFIX/status?path=<absolute dir> */
export const ROUTE_STATUS = `${ROUTE_PREFIX}/status`;
/** POST ROUTE_PREFIX/worktree — create-or-reuse a worktree for a branch. */
export const ROUTE_WORKTREE = `${ROUTE_PREFIX}/worktree`;
/** POST ROUTE_PREFIX/switch — in-place branch switch of the main checkout. */
export const ROUTE_SWITCH = `${ROUTE_PREFIX}/switch`;
/** POST ROUTE_PREFIX/branch — create a NEW branch from the current checkout and switch to it. */
export const ROUTE_BRANCH = `${ROUTE_PREFIX}/branch`;
/** POST ROUTE_PREFIX/fetch — sync remote-tracking refs (fetch every remote + prune). */
export const ROUTE_FETCH = `${ROUTE_PREFIX}/fetch`;
/** POST ROUTE_PREFIX/update — fast-forward the current branch to its upstream. */
export const ROUTE_UPDATE = `${ROUTE_PREFIX}/update`;
/** POST ROUTE_PREFIX/group — git belonging facts for a batch of workspace paths. */
export const ROUTE_GROUP = `${ROUTE_PREFIX}/group`;
/** POST ROUTE_PREFIX/inspect — pre-delete facts for one worktree directory. */
export const ROUTE_INSPECT = `${ROUTE_PREFIX}/inspect`;
/** POST ROUTE_PREFIX/remove — delete one linked worktree (git registration + folder). */
export const ROUTE_REMOVE = `${ROUTE_PREFIX}/remove`;
/** POST ROUTE_PREFIX/exists — batch directory-existence probe (fs, no git). */
export const ROUTE_EXISTS = `${ROUTE_PREFIX}/exists`;
/** POST ROUTE_PREFIX/ensure-directory — mkdir -p a missing worktree storage slot. */
export const ROUTE_ENSURE_DIRECTORY = `${ROUTE_PREFIX}/ensure-directory`;
