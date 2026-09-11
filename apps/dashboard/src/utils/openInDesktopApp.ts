import { isElectronApp } from './electronApp';

/**
 * Slack-style "open in desktop app" handoff.
 *
 * When a shared Xyne Spaces link is opened in a plain browser (e.g. from Slack),
 * we offer to hand it off to the desktop app via its OS-registered custom URL
 * scheme (`xyne-spaces://…`). The Electron side already accepts these links and
 * forwards the path to the renderer router (see
 * `apps/electron/src/services/deep-links.ts` generic-navigation case), so all we
 * do here is build the equivalent deep link and try to open it.
 *
 * This runs once on a full page load, before React mounts, and never inside the
 * desktop app itself.
 */

const ATTEMPTED_KEY = 'xyne:deeplinkAttempted';

/**
 * Persistent (localStorage) opt-out. When the user ticks "Always continue in
 * browser", we store this and never show the interstitial again on this browser
 * profile. This is OUR setting — distinct from Chrome's own "Always allow … open
 * in the associated app" toggle, which lives in Chrome's profile Preferences
 * (protocol_handler.allowed_origin_protocol_pairs), not here.
 */
const OPEN_IN_BROWSER_KEY = 'xyne:openInBrowser';

/**
 * After an open attempt, treat the tab becoming hidden within this window as a
 * successful handoff to the desktop app (the app took foreground). Kept generous
 * because the OS "Open Xyne Spaces?" prompt needs a manual click before the app
 * actually comes forward; scoped to an open attempt so a stray tab switch is
 * unlikely to be misread.
 */
const HANDOFF_ARM_MS = 8000;

/**
 * If nothing is detected, leave the spinner for the optimistic "should be open"
 * state after this delay so the interstitial never appears stuck loading.
 */
const SOFT_ADVANCE_MS = 2500;

/**
 * First path segments that are never shareable content routes and must not
 * trigger the handoff (auth/login/invite flows, Electron pop-out windows, root).
 */
const EXCLUDED_FIRST_SEGMENTS = new Set([
  'login',
  'logout',
  'auth',
  'oauth',
  'signup',
  'invite',
  'v2',
  'newWindow',
  'error',
]);

/**
 * A deep-linkable route is `/{workspaceId}/{subRoute}/…` — a workspace segment
 * followed by at least one sub-route (chat, canvas, tickets, kb, …). Bare
 * `/{workspaceId}` and the excluded auth/flow routes are not eligible.
 */
function isDeepLinkableRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const [firstSegment] = segments;
  if (!firstSegment) return false; // root '/'
  if (EXCLUDED_FIRST_SEGMENTS.has(firstSegment)) return false;
  return segments.length >= 2; // needs a sub-route beneath the workspace
}

/** Custom scheme for the current environment (mirrors electron `config.ts`). */
function getDeepLinkScheme(hostname: string): string {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'xyne-spaces-dev';
  if (hostname.includes('sandbox')) return 'xyne-spaces-sandbox';
  return 'xyne-spaces';
}

/** Build `scheme://{path}{search}{hash}` preserving the full location. */
function buildDeepLink(scheme: string): string {
  const { pathname, search, hash } = window.location;
  return `${scheme}://${pathname.replace(/^\//, '')}${search}${hash}`;
}

/**
 * Auto-attempt: navigate a hidden iframe to the deep link. Using an iframe (vs
 * `location.href`) avoids replacing the top document with a browser error page
 * when the app isn't installed.
 */
function attemptViaIframe(deepLink: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = deepLink;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 2000);
}

/** One-time injection of keyframes used by the spinner. */
function ensureKeyframes(): void {
  if (document.getElementById('xyne-open-app-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'xyne-open-app-keyframes';
  style.textContent = '@keyframes xyne-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);
}

interface OverlayHandlers {
  onOpen: () => void;
  onContinue: () => void;
}

interface OverlayControls {
  overlay: HTMLElement;
  showResult: (confident: boolean) => void;
  /** Focusable elements inside the card, in tab order (for the focus trap). */
  focusables: HTMLElement[];
}

function assign(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

function buildOverlay(handlers: OverlayHandlers): OverlayControls {
  ensureKeyframes();

  const overlay = document.createElement('div');
  overlay.setAttribute('data-testid', 'open-in-desktop-app');
  assign(overlay, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(10, 12, 16, 0.55)',
    backdropFilter: 'blur(6px)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  });
  overlay.style.setProperty('-webkit-backdrop-filter', 'blur(6px)');

  const card = document.createElement('div');
  assign(card, {
    width: 'min(92vw, 380px)',
    background: '#12151c',
    color: '#f2f4f7',
    borderRadius: '18px',
    padding: '32px 28px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 24px 70px rgba(0, 0, 0, 0.45)',
    textAlign: 'center',
    boxSizing: 'border-box',
  });

  // Status icon: spinner while opening, check once opened.
  const icon = document.createElement('div');
  assign(icon, {
    width: '40px',
    height: '40px',
    margin: '0 auto 18px',
  });
  const spinner = document.createElement('div');
  assign(spinner, {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '3px solid rgba(255, 255, 255, 0.15)',
    borderTopColor: '#6366f1',
    animation: 'xyne-spin 0.8s linear infinite',
  });
  icon.appendChild(spinner);

  const title = document.createElement('div');
  title.textContent = 'Opening Xyne Spaces…';
  assign(title, { fontSize: '19px', fontWeight: '600', marginBottom: '8px' });

  const subtitle = document.createElement('div');
  subtitle.textContent = 'This should open in your desktop app.';
  assign(subtitle, {
    fontSize: '14px',
    opacity: '0.6',
    marginBottom: '24px',
    lineHeight: '1.45',
  });

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  primaryBtn.textContent = 'Open Xyne Spaces';
  assign(primaryBtn, {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff',
    background: '#4f46e5',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    marginBottom: '12px',
  });
  primaryBtn.addEventListener('mouseenter', () => {
    primaryBtn.style.background = '#4338ca';
  });
  primaryBtn.addEventListener('mouseleave', () => {
    primaryBtn.style.background = '#4f46e5';
  });

  const secondaryLink = document.createElement('button');
  secondaryLink.type = 'button';
  secondaryLink.textContent = 'Continue in browser';
  assign(secondaryLink, {
    display: 'block',
    width: '100%',
    padding: '8px',
    fontSize: '14px',
    color: 'inherit',
    opacity: '0.6',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  });
  secondaryLink.addEventListener('mouseenter', () => {
    secondaryLink.style.opacity = '0.9';
  });
  secondaryLink.addEventListener('mouseleave', () => {
    secondaryLink.style.opacity = '0.6';
  });

  const setPrimary = (label: string, handler: () => void): void => {
    primaryBtn.textContent = label;
    primaryBtn.onclick = handler;
  };
  const setSecondary = (label: string, handler: () => void): void => {
    secondaryLink.textContent = label;
    secondaryLink.onclick = handler;
  };

  // Default (opening) wiring.
  setPrimary('Open Xyne Spaces', handlers.onOpen);
  setSecondary('Continue in browser', handlers.onContinue);

  // Persistent opt-out: "Always continue in browser". Ticking it stores the
  // preference so the interstitial never shows again on this browser profile.
  const rememberRow = document.createElement('label');
  assign(rememberRow, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '18px',
    fontSize: '13px',
    opacity: '0.6',
    cursor: 'pointer',
  });
  const rememberCheckbox = document.createElement('input');
  rememberCheckbox.type = 'checkbox';
  rememberCheckbox.style.cursor = 'pointer';
  rememberCheckbox.addEventListener('change', () => {
    try {
      if (rememberCheckbox.checked) {
        window.localStorage.setItem(OPEN_IN_BROWSER_KEY, 'true');
      } else {
        window.localStorage.removeItem(OPEN_IN_BROWSER_KEY);
      }
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  });
  const rememberText = document.createElement('span');
  rememberText.textContent = 'Always continue in browser';
  rememberRow.appendChild(rememberCheckbox);
  rememberRow.appendChild(rememberText);

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(primaryBtn);
  card.appendChild(secondaryLink);
  card.appendChild(rememberRow);
  overlay.appendChild(card);

  const makeCheck = (confident: boolean): HTMLElement => {
    const check = document.createElement('div');
    assign(check, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      background: confident ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)',
      color: confident ? '#22c55e' : '#818cf8',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '22px',
      fontWeight: '700',
      lineHeight: '1',
    });
    check.textContent = '✓';
    return check;
  };

  /**
   * Move past the spinner. `confident` = we actually detected the app take
   * foreground; otherwise this is the optimistic "should be open" state so the
   * spinner never runs forever.
   */
  const showResult = (confident: boolean): void => {
    icon.replaceChildren(makeCheck(confident));
    if (confident) {
      title.textContent = 'Opened in Xyne Spaces';
      subtitle.textContent = 'You can close this tab.';
      setPrimary('Continue in browser', handlers.onContinue);
      setSecondary('Reopen in app', handlers.onOpen);
    } else {
      title.textContent = 'Xyne Spaces should be open';
      subtitle.textContent = "Didn't open? Open it again, or continue in your browser.";
      setPrimary('Open Xyne Spaces', handlers.onOpen);
      setSecondary('Continue in browser', handlers.onContinue);
    }
  };

  return { overlay, showResult, focusables: [primaryBtn, secondaryLink, rememberCheckbox] };
}

/**
 * If the current browser page is a shareable Xyne link, attempt to hand it off
 * to the desktop app and show a Slack-style interstitial. No-op inside Electron,
 * on non-content routes, or when already attempted this session.
 */
export function maybeOpenInDesktopApp(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Never inside the desktop app itself (it loads this same bundle), and never
  // under the bundled-UI custom protocol.
  if (isElectronApp()) return;
  if (window.location.protocol.startsWith('xyne-spaces')) return;

  // Persistent opt-out — the user chose "Always continue in browser".
  try {
    if (window.localStorage.getItem(OPEN_IN_BROWSER_KEY) === 'true') return;
  } catch {
    // localStorage unavailable — fall through.
  }

  // Only full external loads — an in-tab SPA reload must not re-trigger.
  try {
    if (window.sessionStorage.getItem(ATTEMPTED_KEY) === 'true') return;
  } catch {
    // sessionStorage unavailable — fall through and attempt once.
  }

  if (!isDeepLinkableRoute(window.location.pathname)) return;

  try {
    window.sessionStorage.setItem(ATTEMPTED_KEY, 'true');
  } catch {
    // ignore
  }

  const scheme = getDeepLinkScheme(window.location.hostname);
  const deepLink = buildDeepLink(scheme);

  const mount = (): void => {
    // 'opening' → spinner, 'soft' → optimistic "should be open", 'opened' →
    // confirmed handoff (tab went to background).
    let phase: 'opening' | 'soft' | 'opened' = 'opening';
    // Tab hidden within this window after an attempt ⇒ the app took foreground.
    let armedUntil = 0;
    let softTimer = 0;

    const arm = (): void => {
      armedUntil = Date.now() + HANDOFF_ARM_MS;
    };

    const triggerOpen = (viaIframe: boolean): void => {
      arm();
      if (viaIframe) {
        attemptViaIframe(deepLink);
      } else {
        // A real user gesture makes the OS "Open Xyne Spaces?" prompt reliable.
        window.location.href = deepLink;
      }
    };

    let controls: OverlayControls | null = null;

    const onVisibility = (): void => {
      // Confirmed handoff — the app took foreground shortly after an attempt.
      if (document.visibilityState === 'hidden' && Date.now() < armedUntil && phase !== 'opened') {
        phase = 'opened';
        window.clearTimeout(softTimer);
        controls?.showResult(true);
      }
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return;
      }
      // Keep keyboard focus inside the card while it's open.
      if (e.key === 'Tab' && controls && controls.focusables.length > 0) {
        const { focusables } = controls;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const dismiss = (): void => {
      window.clearTimeout(softTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', onKeydown);
      controls?.overlay.remove();
    };

    controls = buildOverlay({
      onOpen: () => triggerOpen(false),
      onContinue: () => dismiss(),
    });

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(controls.overlay);
    // Move focus to the primary action so keyboard users can act immediately.
    controls.focusables[0]?.focus();

    // Best-effort silent auto-attempt on load; the interstitial stays either way
    // so the user can click "Open Xyne Spaces" or "Continue in browser".
    triggerOpen(true);

    // Never leave the spinner running forever — advance to the optimistic state
    // if we haven't confirmed a handoff by then. A later confirmation still
    // upgrades it to the "Opened" state via onVisibility.
    softTimer = window.setTimeout(() => {
      if (phase === 'opening') {
        phase = 'soft';
        controls?.showResult(false);
      }
    }, SOFT_ADVANCE_MS);
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
}
