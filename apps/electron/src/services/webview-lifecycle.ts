import { webContents, type WebContents } from 'electron';
import log from 'electron-log/main';

/**
 * Freezes a page of the in-app browsers that is out of sight, so it runs nothing —
 * no timers, no scripts — and wakes it when it is shown again: what Chrome does to
 * background tabs. A frozen page keeps everything it had, and carries on from where
 * it was once woken.
 *
 * Done through the page's own debugger, which the app already uses to give pages
 * its theme (webview-theme.ts).
 */
async function setFrozen(page: WebContents, frozen: boolean): Promise<boolean> {
  try {
    if (!page.debugger.isAttached()) page.debugger.attach('1.3');
    await page.debugger.sendCommand('Page.setWebLifecycleState', {
      state: frozen ? 'frozen' : 'active',
    });
    return true;
  } catch (error) {
    // Something else holds its debugger — its DevTools, say: it stays awake.
    log.warn('[WebviewLifecycle] Could not change the page state', error);
    return false;
  }
}

/**
 * Freezes or wakes a page, for the window that holds it: only a webview, and only
 * one that window embeds.
 */
export async function setEmbeddedPageFrozen(
  host: WebContents,
  pageId: number,
  frozen: boolean,
): Promise<boolean> {
  const page = webContents.fromId(pageId);
  if (!page || page.isDestroyed() || page.getType() !== 'webview') return false;
  if (page.hostWebContents !== host) return false;
  return setFrozen(page, frozen);
}
