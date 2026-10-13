/**
 * Browser keys pressed while a page has the keyboard. The page, not the app, hears
 * them then, so they reach the app one of two ways:
 *
 * - From the desktop app, which sees the real key press before the page does and
 *   passes it on (`onBrowserCommand`). A page can't fake these.
 * - From a desktop app from before it could, through the page's console: a small
 *   script added to each page passes the keys on. A page could write the same lines
 *   itself, so this way only ever carries harmless commands — back, forward, the
 *   address bar, the tab list — and is not used where the first way is there.
 *
 * ⌘T, ⌘F and ⌘R come from the desktop app in every version, through their own
 * messages.
 */

export type PageKeyCommand =
  | 'focusAddress'
  | 'tabs'
  | 'back'
  | 'forward'
  | 'nextTab'
  | 'previousTab'
  | 'reopenTab'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset';

const PAGE_KEY_COMMANDS: readonly string[] = [
  'focusAddress',
  'tabs',
  'back',
  'forward',
  'nextTab',
  'previousTab',
  'reopenTab',
  'zoomIn',
  'zoomOut',
  'zoomReset',
];

/** The commands a page's console may carry: none that does more than move around. */
const CONSOLE_COMMANDS: readonly string[] = ['focusAddress', 'tabs', 'back', 'forward'];

export const isPageKeyCommand = (value: string): value is PageKeyCommand =>
  PAGE_KEY_COMMANDS.includes(value);

/** What marks a page's console line as one of ours. */
const KEY_SIGNAL = '⁣xyne-key:';

/** Added to each page as it loads, where the desktop app can't pass keys on itself. */
export const KEY_RELAY = `(() => {
  if (window.__xyneKeyRelay) return;
  window.__xyneKeyRelay = true;
  const say = console.debug.bind(console);
  addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const command = key === 'l' && !event.shiftKey ? 'focusAddress'
      : key === 'p' && !event.shiftKey ? 'tabs'
      : key === '[' ? 'back' : key === ']' ? 'forward' : null;
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    say('${KEY_SIGNAL}' + command);
  }, true);
})()`;

/**
 * What a page says when its floating video was sent back to its tab: Chromium's
 * "back to tab" closes the floating window and leaves the video playing, where its
 * close button pauses it.
 */
export const PICTURE_IN_PICTURE_RETURN = `${KEY_SIGNAL}pipBackToTab`;

/** A console line's command, when it is one of ours. */
export function consoleCommand(line: string | undefined): PageKeyCommand | null {
  if (!line?.startsWith(KEY_SIGNAL)) return null;
  const command = line.slice(KEY_SIGNAL.length);
  return CONSOLE_COMMANDS.includes(command) && isPageKeyCommand(command) ? command : null;
}

/** The app's own keys, pressed in a page: showing or hiding its browser, docking it. */
export type AppKeyCommand = 'toggleBrowser' | 'toggleDock';

/**
 * Hears the app's own keys pressed in any page of the window's browsers, which the
 * desktop app passes on as it does the browser keys.
 */
export function subscribeToAppKeys(onCommand: (command: AppKeyCommand) => void): () => void {
  const api = window.electronAPI;
  if (!api?.onBrowserCommand) return () => undefined;
  return api.onBrowserCommand(command => {
    if (command === 'toggleBrowser' || command === 'toggleDock') onCommand(command);
  });
}

/** Whether the desktop app passes page keys on itself, so pages need no relay. */
export function desktopPassesPageKeys(): boolean {
  return typeof window.electronAPI?.onBrowserCommand === 'function';
}

/**
 * Hears page keys from the desktop app. Every browser in the window hears every
 * key; each acts only when the page with the keyboard is one of its own.
 */
export function subscribeToPageKeys(onCommand: (command: PageKeyCommand) => void): () => void {
  const api = window.electronAPI;
  if (!api?.onBrowserCommand) return () => undefined;
  return api.onBrowserCommand(command => {
    if (isPageKeyCommand(command)) onCommand(command);
  });
}
