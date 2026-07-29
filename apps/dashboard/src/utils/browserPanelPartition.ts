import { API_BASE_URL } from '../config';

/**
 * Webview partition used exclusively for Xyne-internal tabs inside the
 * browser panel. Mirrors the constant on the Electron side
 * (`electron/src/services/cookies.ts:XYNE_SPACES_PARTITION`) — keep them in
 * sync.
 */
export const XYNE_SPACES_PARTITION = 'persist:xyne-spaces';

/**
 * Default partition for arbitrary external sites opened in the browser panel.
 */
export const BROWSER_TABS_PARTITION = 'persist:browser-tabs';

const xyneOrigins = (() => {
  const origins = new Set<string>();
  if (typeof window !== 'undefined') {
    origins.add(window.location.origin);
  }
  try {
    origins.add(new URL(API_BASE_URL).origin);
  } catch {
    /* ignore — API_BASE_URL is always well-formed in practice */
  }
  return origins;
})();

/**
 * Returns true if `url` points at a Xyne-owned origin. Used to route tabs to
 * the isolated `persist:xyne-spaces` partition.
 */
export function isXyneOrigin(url: string): boolean {
  try {
    return xyneOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Picks the correct webview partition for a tab based on its initial URL.
 * Xyne URLs land in the dedicated Xyne partition (cookies synced from the
 * main app), everything else uses the shared external-browser partition.
 */
export function pickWebviewPartition(url: string): string {
  return isXyneOrigin(url) ? XYNE_SPACES_PARTITION : BROWSER_TABS_PARTITION;
}
