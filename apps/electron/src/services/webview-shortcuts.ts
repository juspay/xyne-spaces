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

/**
 * Browser keys a window's app takes from its pages once it says it can: back,
 * forward, the address, the tab list and moving between tabs. Pressed in a page,
 * they would otherwise go to the page — and an app from before these existed never
 * says it can, so its pages keep getting them as they always did.
 */
type BrowserCommand =
  | 'focusAddress'
  | 'tabs'
  | 'back'
  | 'forward'
  | 'nextTab'
  | 'previousTab'
  | 'reopenTab'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  // The app's own: showing or hiding its browser, and docking or undocking it.
  | 'toggleBrowser'
  | 'toggleDock';

const BROWSER_COMMAND_KEYS: ReadonlyArray<{ key: string; shift: boolean; command: BrowserCommand }> = [
  { key: 'l', shift: false, command: 'focusAddress' },
  { key: 'p', shift: false, command: 'tabs' },
  { key: '[', shift: false, command: 'back' },
  { key: ']', shift: false, command: 'forward' },
  // ⌘⇧[ and ⌘⇧]; some layouts report the shifted key as { and }.
  { key: '[', shift: true, command: 'previousTab' },
  { key: '{', shift: true, command: 'previousTab' },
  { key: ']', shift: true, command: 'nextTab' },
  { key: '}', shift: true, command: 'nextTab' },
  { key: 'b', shift: true, command: 'toggleBrowser' },
  { key: 'f', shift: true, command: 'toggleDock' },
  { key: 't', shift: true, command: 'reopenTab' },
  // ⌘= and ⌘+ (⇧= on most layouts), ⌘-, ⌘0: the page's zoom.
  { key: '=', shift: false, command: 'zoomIn' },
  { key: '=', shift: true, command: 'zoomIn' },
  { key: '+', shift: true, command: 'zoomIn' },
  { key: '+', shift: false, command: 'zoomIn' },
  { key: '-', shift: false, command: 'zoomOut' },
  { key: '0', shift: false, command: 'zoomReset' },
];

/** The windows whose app has said it handles browser keys. */
const commandWindows = new Set<number>();

/**
 * Notes that a window's app handles browser keys for its pages, until the window
 * loads a new document — which says so again if it is one that can.
 */
export function acceptBrowserCommands(host: WebContents, accept: boolean): void {
  if (!accept) {
    commandWindows.delete(host.id);
    return;
  }
  if (commandWindows.has(host.id)) return;
  commandWindows.add(host.id);
  const forget = (): void => {
    commandWindows.delete(host.id);
    host.removeListener('did-navigate', forget);
  };
  host.on('did-navigate', forget);
  host.once('destroyed', forget);
}

/** Whether a window's app takes browser keys, and so the View menu's zoom. */
export function acceptsBrowserCommands(host: WebContents): boolean {
  return commandWindows.has(host.id);
}

/** The window holding a page: the one to tell about its keys. */
function hostOf(webviewContents: WebContents): WebContents | null {
  const host = webviewContents.hostWebContents;
  if (host && !host.isDestroyed()) return host;
  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function browserCommandFor(
  key: string,
  input: Electron.Input,
  modifier: boolean,
): BrowserCommand | null {
  // ⌃Tab and ⌃⇧Tab move between tabs everywhere, as in any browser.
  if (key === 'tab' && input.control && !input.meta && !input.alt) {
    return input.shift ? 'previousTab' : 'nextTab';
  }
  if (!modifier || input.alt) return null;
  const match = BROWSER_COMMAND_KEYS.find(
    candidate => candidate.key === key && candidate.shift === (input.shift ?? false),
  );
  return match?.command ?? null;
}

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
  // ⌘-scroll (Ctrl-scroll) over a page asks to zoom it, which Electron leaves to the
  // app: passed on to the window holding the page, naming the page.
  webviewContents.on('zoom-changed', (_event, direction) => {
    hostOf(webviewContents)?.send('browser-page-zoom', webviewContents.id, direction);
  });

  webviewContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const isMac = process.platform === 'darwin';
    const modifier = isMac ? input.meta : input.control;
    const key = input.key.toLowerCase();

    const host = hostOf(webviewContents);
    const command = browserCommandFor(key, input, modifier);
    if (command && host && commandWindows.has(host.id)) {
      event.preventDefault();
      host.send('browser-command', command);
      return;
    }
    if (!modifier) return;

    for (const shortcut of WEBVIEW_SHORTCUTS) {
      if (shortcut.key !== key) continue;
      if ((shortcut.shift ?? false) !== (input.shift ?? false)) continue;
      if ((shortcut.alt ?? false) !== (input.alt ?? false)) continue;

      // Default: prevent the event from reaching manager.ts / the OS
      if (shortcut.preventDefault !== false) {
        event.preventDefault();
      }

      if (shortcut.action.type === 'ipc') {
        // To the window the page is in — a folder's own window, as much as the
        // main one — which works out which of its pages has the keyboard.
        host?.send(shortcut.action.channel);
      } else {
        shortcut.action.fn(webviewContents);
      }

      // Only one shortcut should match per keypress
      break;
    }
  });
}
