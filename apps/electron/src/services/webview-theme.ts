import { nativeTheme, webContents, type WebContents } from 'electron';
import log from 'electron-log/main';

/**
 * Pages in the in-app browsers see the app's theme, not the OS's, as
 * prefers-color-scheme — as they would in a browser set to dark or light.
 *
 * Each webview is told directly, through Chromium's media emulation, which it keeps
 * for every page it loads from then on, and which applies before a page first
 * paints. Only these pages: the app's menus, dialogs and other windows go on
 * following the OS, as nativeTheme.themeSource would have changed them all.
 */

/** The app's theme, once it has said; the OS's until then. */
let appScheme: 'light' | 'dark' | null = null;

const schemeNow = (): 'light' | 'dark' =>
  appScheme ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

function applyAppScheme(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    void contents.debugger
      .sendCommand('Emulation.setEmulatedMedia', {
        features: [
          {
            name: 'prefers-color-scheme',
            value: schemeNow(),
          },
        ],
      })
      .catch(() => undefined);
  } catch (error) {
    // Something else holds its debugger: the page keeps the system's scheme.
    log.warn('[WebviewTheme] Could not set the page scheme', error);
  }
}

function applyToAll(): void {
  for (const each of webContents.getAllWebContents()) {
    if (each.getType() === 'webview') applyAppScheme(each);
  }
}

/** The app's theme changed: every in-app browser page follows it. */
export function setAppScheme(theme: 'light' | 'dark'): void {
  if (appScheme === theme) return;
  appScheme = theme;
  applyToAll();
}

let listening = false;

/** Has a new webview follow the app's theme, now and whenever it changes. */
export function followAppTheme(contents: WebContents): void {
  if (!listening) {
    listening = true;
    // Until the app says its theme, pages follow the OS's as it changes.
    nativeTheme.on('updated', () => {
      if (appScheme === null) applyToAll();
    });
  }
  applyAppScheme(contents);
}
