/** Radix coordinates nested overlays; fullscreen still needs its own DOM layer. */
export function overlayContainer(): HTMLElement | Element {
  return document.fullscreenElement ?? document.body;
}
