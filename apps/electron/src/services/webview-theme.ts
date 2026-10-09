import { nativeTheme, webContents, type WebContents } from 'electron';
import log from 'electron-log/main';

/**
 * Pages in the in-app browsers see the app's theme, not the OS's, as
 * prefers-color-scheme — as they would in a browser set to dark or light.
 *
 * nativeTheme.themeSource alone doesn't hold for a webview: its page takes the
 * scheme, but the next page it loads goes back to the system's. So each webview is
 * told directly, through Chromium's media emulation, which it keeps for every page
 * it loads from then on, and which applies before a page first paints.
 */
function applyAppScheme(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    void contents.debugger
      .sendCommand('Emulation.setEmulatedMedia', {
        features: [
          {
            name: 'prefers-color-scheme',
            value: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
          },
        ],
      })
      .catch(() => undefined);
  } catch (error) {
    // Something else holds its debugger: the page keeps the system's scheme.
    log.warn('[WebviewTheme] Could not set the page scheme', error);
  }
}

let listening = false;

/** Has a new webview follow the app's theme, now and whenever it changes. */
export function followAppTheme(contents: WebContents): void {
  if (!listening) {
    listening = true;
    // One listener for every webview, rather than one each.
    nativeTheme.on('updated', () => {
      for (const each of webContents.getAllWebContents()) {
        if (each.getType() === 'webview') applyAppScheme(each);
      }
    });
  }
  applyAppScheme(contents);
}
