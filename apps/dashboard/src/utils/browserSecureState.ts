/**
 * The in-app browser's open tabs and per-site zoom, kept by the desktop app
 * encrypted with the system's key — the Keychain on a Mac — rather than in the
 * app's own storage. A desktop app from before it could keep them leaves them in the
 * app's preferences, as they were.
 */

export type SecureBrowserKey = 'tabs' | 'zoom';

let secure: Promise<boolean> | null = null;

/**
 * Whether the desktop app keeps the browser's state itself — only where it can
 * encrypt it to disk. Where it can't (Linux without a keyring, say) it would hold it
 * in memory only, so the app keeps its own copy, as before. Asked once.
 */
export function keepsBrowserStateSecurely(): Promise<boolean> {
  secure ??= (async () => {
    const api = window.electronAPI;
    if (typeof api?.getBrowserState !== 'function' || typeof api.setBrowserState !== 'function') {
      return false;
    }
    if (typeof api.isBrowserStateSecure !== 'function') return false;
    return api.isBrowserStateSecure().then(
      onDisk => onDisk === true,
      () => false,
    );
  })();
  return secure;
}

export async function readSecureBrowserState(key: SecureBrowserKey): Promise<unknown> {
  const api = window.electronAPI;
  if (!api?.getBrowserState) return null;
  return api.getBrowserState(key).catch(() => null);
}

export function writeSecureBrowserState(key: SecureBrowserKey, value: unknown): void {
  void window.electronAPI?.setBrowserState?.(key, value).catch(() => undefined);
}
