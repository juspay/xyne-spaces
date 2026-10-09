/**
 * The in-app browser's open tabs and per-site zoom, kept by the desktop app
 * encrypted with the system's key — the Keychain on a Mac — rather than in the
 * app's own storage. A desktop app from before it could keep them leaves them in the
 * app's preferences, as they were.
 */

export type SecureBrowserKey = 'tabs' | 'zoom';

/** Whether the desktop app keeps the browser's state itself. */
export function keepsBrowserStateSecurely(): boolean {
  const api = window.electronAPI;
  return typeof api?.getBrowserState === 'function' && typeof api.setBrowserState === 'function';
}

export async function readSecureBrowserState(key: SecureBrowserKey): Promise<unknown> {
  const api = window.electronAPI;
  if (!api?.getBrowserState) return null;
  return api.getBrowserState(key).catch(() => null);
}

export function writeSecureBrowserState(key: SecureBrowserKey, value: unknown): void {
  void window.electronAPI?.setBrowserState?.(key, value).catch(() => undefined);
}
