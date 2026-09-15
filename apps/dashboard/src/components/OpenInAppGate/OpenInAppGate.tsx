import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { buildDeepLinkUrl, attemptAppLaunch, isElectronApp } from '../../utils/deepLink';

/**
 * Offers to hand a shared web link off to the installed desktop app.
 *
 * A xyne-spaces link shared in Slack (or anywhere outside the app) is a plain
 * https URL, so the OS opens it in the browser. The desktop app only registers
 * the xyne-spaces:// custom scheme, so nothing routes an https link to it. This
 * gate closes that gap entirely on the web side: when someone lands on the web
 * app from an external context, it offers to re-open the same path in the desktop
 * app via the custom scheme, and can remember that choice.
 *
 * It NEVER auto-hands-off without a stored "always" preference, never runs inside
 * the desktop app itself, and always leaves the user on the web page as the
 * fallback — a user without the app installed is unaffected.
 */

const PREF_KEY = 'xyne.openInAppPreference'; // 'always' | 'never'
const TAB_DISMISS_KEY = 'xyne.openInApp.dismissed'; // '1' for this tab

type Preference = 'always' | 'never' | null;

// Route segments where a hand-off would loop or fight auth. Matched against the
// first two path segments (paths are /:workspaceId/<route>, but auth/launch
// routes sit at the root without a workspace prefix).
const BLOCKED_SEGMENTS = new Set([
  'launch',
  'login',
  'auth',
  'invite',
  'external',
  'newWindow',
  'redirected',
  'onboarding',
  'slack-migration',
]);

function readPreference(): Preference {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'always' || v === 'never' ? v : null;
  } catch {
    return null;
  }
}

function wasDismissedThisTab(): boolean {
  try {
    return sessionStorage.getItem(TAB_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function markDismissedThisTab(): void {
  try {
    sessionStorage.setItem(TAB_DISMISS_KEY, '1');
  } catch {
    // ignore
  }
}

function isReloadOrBackForward(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return nav?.type === 'reload' || nav?.type === 'back_forward';
  } catch {
    return false;
  }
}

function hasSameOriginReferrer(): boolean {
  if (!document.referrer) return false; // no referrer = external / direct (Slack, pasted link)
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

function isBlockedPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  const segments = pathname.split('/').filter(Boolean);
  return segments.slice(0, 2).some(seg => BLOCKED_SEGMENTS.has(seg));
}

/** One-time evaluation of whether the gate may act on this page load. */
function computeEligibility(): boolean {
  if (typeof window === 'undefined') return false;
  if (isElectronApp()) return false; // already in the desktop app
  if (window.top !== window.self) return false; // embedded iframe (e.g. SDLC surface)
  if (isBlockedPath(window.location.pathname)) return false;
  if (isReloadOrBackForward()) return false; // only on genuine external entries
  if (hasSameOriginReferrer()) return false; // in-app navigation, not an external open
  if (wasDismissedThisTab()) return false;
  return true;
}

const OpenInAppGate = (): ReactElement | null => {
  const eligible = useMemo(computeEligibility, []);
  const [preference, setPreference] = useState<Preference>(() => readPreference());
  const [showBanner, setShowBanner] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const deepLinkUrl = useMemo(
    () =>
      buildDeepLinkUrl({
        pathname: window.location.pathname,
        search: window.location.search,
      }),
    [],
  );

  useEffect(() => {
    if (!eligible) return undefined;

    if (preference === 'never') return undefined;

    if (preference === 'always') {
      markDismissedThisTab();
      cleanupRef.current = attemptAppLaunch(deepLinkUrl);
      return () => cleanupRef.current?.();
    }

    // No stored preference: show the banner, never auto-launch.
    setShowBanner(true);
    return undefined;
  }, [eligible, preference, deepLinkUrl]);

  const dismiss = (): void => {
    markDismissedThisTab();
    setShowBanner(false);
  };

  const openOnce = (): void => {
    markDismissedThisTab();
    cleanupRef.current = attemptAppLaunch(deepLinkUrl);
    setShowBanner(false);
  };

  const openAlways = (): void => {
    try {
      localStorage.setItem(PREF_KEY, 'always');
    } catch {
      // ignore
    }
    markDismissedThisTab();
    cleanupRef.current = attemptAppLaunch(deepLinkUrl);
    setPreference('always');
    setShowBanner(false);
  };

  const dontAskAgain = (): void => {
    try {
      localStorage.setItem(PREF_KEY, 'never');
    } catch {
      // ignore
    }
    setPreference('never');
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div
      role='dialog'
      aria-label='Open in desktop app'
      data-testid='open-in-app-gate'
      className='fixed bottom-4 left-1/2 z-[9999] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg sm:flex-row sm:items-center sm:justify-between'
    >
      <div className='flex items-center gap-3'>
        <img src='/svgs/xyne.svg' alt='' aria-hidden='true' className='h-8 w-8 shrink-0' />
        <div className='text-sm'>
          <p className='font-semibold'>Open this in the Xyne Spaces desktop app?</p>
          <p className='text-muted-foreground'>
            You&apos;ll get the full app experience for this link.
          </p>
        </div>
      </div>
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={openOnce}
          data-testid='open-in-app-once'
          className='rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90'
        >
          Open in app
        </button>
        <button
          type='button'
          onClick={openAlways}
          data-testid='open-in-app-always'
          className='rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent'
        >
          Always
        </button>
        <button
          type='button'
          onClick={dontAskAgain}
          data-testid='open-in-app-never'
          className='rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
        >
          Don&apos;t ask again
        </button>
        <button
          type='button'
          onClick={dismiss}
          aria-label='Dismiss'
          className='rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground'
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default OpenInAppGate;
