/**
 * Shared wire contract between the host half (HTTP routes under
 * `/plugin/git-worktree`) and the browser half (chip + settings section).
 * Zero runtime dependencies: constants and types only, imported by both
 * builds.
 */
/** Absolute pathname prefix every route of this plugin lives under. */
export const ROUTE_PREFIX = '/plugin/git-worktree';
/** GET ROUTE_PREFIX/status?path=<absolute dir> */
export const ROUTE_STATUS = `${ROUTE_PREFIX}/status`;
/** GET/PUT ROUTE_PREFIX/settings — the plugin's own persisted configuration. */
export const ROUTE_SETTINGS = `${ROUTE_PREFIX}/settings`;
/** POST ROUTE_PREFIX/worktree — create-or-reuse a worktree for a branch. */
export const ROUTE_WORKTREE = `${ROUTE_PREFIX}/worktree`;
/** POST ROUTE_PREFIX/switch — in-place branch switch of the main checkout. */
export const ROUTE_SWITCH = `${ROUTE_PREFIX}/switch`;
