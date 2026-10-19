/** Host window chrome above the page, in pixels.
 * `--dsh-frame-chrome-top` is the live height, including an explicit 0 when
 * fullscreen hides the bar. `--dsh-frame-top-clearance` is only the fallback
 * for hosts that publish a static inset (the mac traffic-light band) and no
 * live value. An unset or non-numeric custom property means there is no chrome. */
export function hostFrameTop(chrome: string, clearance: string): number {
  const px = (value: string): number | null => {
    const n = Number.parseFloat(value)
    if (!Number.isFinite(n)) return null
    return n > 0 ? n : 0
  }
  return px(chrome) ?? px(clearance) ?? 0
}
