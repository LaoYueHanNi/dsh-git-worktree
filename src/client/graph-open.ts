/** Graph mode across a branch-menu open transition.
 * Turning the setting on makes the click that opens the menu start in the
 * graph. While the setting is off, a mode the user already chose survives
 * closing the popup. An already-open menu is left alone. */
export function graphOpenAfter(wasOpen: boolean, open: boolean, defaultGraph: boolean, graphOpen: boolean): boolean {
  if (open && !wasOpen && defaultGraph) return true
  return graphOpen
}
