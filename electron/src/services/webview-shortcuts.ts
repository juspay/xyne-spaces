/**
 * Webview Keyboard Shortcuts
 *
 * Centralises all keyboard shortcut handling for <webview> elements.
 * Shortcuts are intercepted in the main process via `before-input-event` on
 * each webview's webContents — this is the only approach that works reliably
 * in both dev and packaged builds (the renderer-side preload path can differ,
 * and `webContents.getFocusedWebContents()` returns null in production).
 *
 * HOW TO ADD A NEW SHORTCUT
 * --------------------------
 * 1. Add an entry to WEBVIEW_SHORTCUTS below.
 * 2. If it should send an IPC message to the renderer, add the channel name.
 *    The corresponding listener must already exist in preload.ts / the renderer.
 * 3. If it should execute directly in the main process, add a `handler` fn.
 *
 * Do NOT add shortcut logic directly to main.ts or manager.ts.
 */

import { WebContents } from 'electron';
import { getMainWindow } from '../window/manager';

type ShortcutAction =
  | { type: 'ipc'; channel: string }          // send an IPC message to the main window renderer
  | { type: 'handler'; fn: (wv: WebContents) => void }; // run arbitrary main-process logic

interface ShortcutDefinition {
  /** modifier + key combination */
  key: string;
  shift?: boolean;
  alt?: boolean;
  /** what to do when triggered */
  action: ShortcutAction;
  /** whether to call event.preventDefault() — default true */
  preventDefault?: boolean;
}

/**
 * All webview keyboard shortcuts.
 * Add new shortcuts here — no other file needs to change.
 */
const WEBVIEW_SHORTCUTS: ShortcutDefinition[] = [
  // ── Tab management ───────────────────────────────────────────────────────
  {
    key: 't',
    action: { type: 'ipc', channel: 'browser-new-tab' },
  },

  // ── Find in page ─────────────────────────────────────────────────────────
  {
    key: 'f',
    action: { type: 'ipc', channel: 'browser-find-in-page' },
  },

  // ── Reload (soft) ────────────────────────────────────────────────────────
  {
    key: 'r',
    action: {
      type: 'handler',
      fn: (wv) => wv.reload(),
    },
  },

  // ── Hard reload (clear cache) ─────────────────────────────────────────────
  {
    key: 'r',
    shift: true,
    action: {
      type: 'handler',
      fn: (wv) => wv.reloadIgnoringCache(),
    },
  },
];

/**
 * Attaches the shortcut listener to a single webview webContents.
 * Called from `web-contents-created` in main.ts whenever a new webview is
 * created.
 */
export function setupWebviewShortcuts(webviewContents: WebContents): void {
  webviewContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const isMac = process.platform === 'darwin';
    const modifier = isMac ? input.meta : input.control;
    if (!modifier) return;

    const key = input.key.toLowerCase();

    for (const shortcut of WEBVIEW_SHORTCUTS) {
      if (shortcut.key !== key) continue;
      if ((shortcut.shift ?? false) !== (input.shift ?? false)) continue;
      if ((shortcut.alt ?? false) !== (input.alt ?? false)) continue;

      // Default: prevent the event from reaching manager.ts / the OS
      if (shortcut.preventDefault !== false) {
        event.preventDefault();
      }

      if (shortcut.action.type === 'ipc') {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(shortcut.action.channel);
        }
      } else {
        shortcut.action.fn(webviewContents);
      }

      // Only one shortcut should match per keypress
      break;
    }
  });
}
