import { isProd, isSandBox } from '../config';

/**
 * Custom URL scheme the desktop (Electron) app registers per flavor. Mirrors
 * DEEP_LINK_PROTOCOL in apps/electron/src/app/config.ts and the derivation in
 * routes/LaunchScreen/LaunchScreen.tsx — keep the three in step.
 */
export const DEEP_LINK_PROTOCOL = isProd
  ? 'xyne-spaces'
  : isSandBox
    ? 'xyne-spaces-sandbox'
    : 'xyne-spaces-dev';

/** True when the current page is the packaged desktop app, not a browser tab. */
export function isElectronApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Bundled UI is served over the custom scheme; the dev/sandbox shells expose electronAPI.
  return window.location.protocol.startsWith('xyne-spaces') || window.electronAPI !== undefined;
}

/**
 * Turn an in-app location into a xyne-spaces:// deep link the desktop app can open.
 *
 * The Electron handler's isSafeDeepLinkPath (apps/electron/src/services/deep-links.ts)
 * only accepts the path + query charset and REJECTS '#', so any hash fragment
 * (e.g. #origin=…&messageId= for scroll-to-message) is intentionally dropped here.
 * The channel/thread ids that decide which screen opens live in the path, so the
 * app still lands on the right conversation — only the exact-message scroll is lost.
 */
export function buildDeepLinkUrl(location: {
  pathname: string;
  search: string;
}): string {
  const path = location.pathname.startsWith('/')
    ? location.pathname.slice(1)
    : location.pathname;
  return `${DEEP_LINK_PROTOCOL}://${path}${location.search || ''}`;
}

/**
 * Ask the OS to open a xyne-spaces:// URL. Browsers show their own
 * "Open Xyne Spaces?" confirmation; if the user accepts, our window loses focus
 * (or the page is hidden), which we treat as a successful hand-off. We never
 * redirect the browser ourselves — the web page the user is already on stays put
 * as the fallback, so a user without the app installed simply keeps using web.
 *
 * Returns a cleanup function; call it if the caller unmounts early.
 */
export function attemptAppLaunch(url: string, onResolved?: (launched: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let lostFocus = false;
  const onBlur = (): void => {
    lostFocus = true;
  };
  window.addEventListener('blur', onBlur);

  // Triggering the scheme on a hidden anchor avoids replacing the current
  // document if the OS has no handler (some browsers navigate on location.href).
  try {
    window.location.href = url;
  } catch {
    // no-op: browsers throw when there is no registered handler
  }

  const timer = window.setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    const launched =
      lostFocus || (typeof document.hidden !== 'undefined' && document.hidden);
    onResolved?.(launched);
  }, 2500);

  return (): void => {
    window.clearTimeout(timer);
    window.removeEventListener('blur', onBlur);
  };
}
