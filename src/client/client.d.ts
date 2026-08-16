/**
 * The browser half's module face: the factory-closure bundle `lib/client.js`
 * registers itself through `window.__ModuleLoader__.load` at fetch time and
 * has no importable Node surface. This declaration only names the exports
 * map entry the client-modules host half resolves.
 */

export const inject: readonly string[]
export function apply(ctx: unknown): void
