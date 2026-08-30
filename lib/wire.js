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
