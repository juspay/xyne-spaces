/**
 * Webviews that handle their own popups.
 *
 * Electron's main process denies every popup a webview asks for and forwards the
 * url to the app as `open-in-browser-panel`, which is right for the browser
 * panel's own tabs. It is wrong for a page embedded somewhere else — following a
 * link inside the SDLC lane's browser should stay in that browser, not fling the
 * reader into a panel on the other side of the window.
 *
 * Main sends the originating webview's id alongside the url; anything listed
 * here claims its own popups.
 */
const handlers = new Map<number, (url: string) => void>();

export function registerEmbeddedWebview(
  webContentsId: number,
  onPopup: (url: string) => void,
): () => void {
  handlers.set(webContentsId, onPopup);
  return () => {
    if (handlers.get(webContentsId) === onPopup) handlers.delete(webContentsId);
  };
}

/** True when the url was claimed, and the browser panel should stay out of it. */
export function routePopupToEmbeddedWebview(url: string, webContentsId?: number): boolean {
  if (webContentsId === undefined) return false;
  const handler = handlers.get(webContentsId);
  if (!handler) return false;
  handler(url);
  return true;
}
