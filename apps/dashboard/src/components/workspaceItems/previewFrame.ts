export const IFRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups';

const SANDBOX_PREVIEW_PREFIXES = ['/claw-preview/', '/claw-code/', '/claw-term/'];

export const SANDBOX_PREVIEW_IFRAME_SANDBOX = `${IFRAME_SANDBOX} allow-same-origin allow-downloads`;

export const SANDBOX_PREVIEW_ALLOW = 'clipboard-write; fullscreen';

/**
 * Where sandbox previews are served from. Empty until the preview host exists,
 * which is the safe state: no frame is granted same-origin access to anything.
 */
export function configuredPreviewOrigin(): string {
  const raw = import.meta.env.VITE_SANDBOX_PREVIEW_ORIGIN?.trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

export type PreviewFrameMode =
  | { kind: 'frame'; sandbox: string; allow?: string }
  | { kind: 'shares-dashboard-origin' };

/**
 * A sandbox preview needs storage and its own WebSocket, so it needs a real
 * origin — but a sandbox serves agent-written code, so that origin must never
 * be the dashboard's. Granting is an allowlist of one: the configured preview
 * host. Anything else keeps the default sandbox, and a preview on our own
 * origin is refused rather than framed.
 */
export function previewFrameMode(
  url: string,
  dashboardOrigin: string = window.location.origin,
  previewOrigin: string = configuredPreviewOrigin(),
): PreviewFrameMode {
  let parsed: URL;
  try {
    parsed = new URL(url, dashboardOrigin);
  } catch {
    return { kind: 'frame', sandbox: IFRAME_SANDBOX };
  }
  if (!SANDBOX_PREVIEW_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix))) {
    return { kind: 'frame', sandbox: IFRAME_SANDBOX };
  }
  if (parsed.origin === dashboardOrigin) {
    return { kind: 'shares-dashboard-origin' };
  }
  if (!previewOrigin || parsed.origin !== previewOrigin) {
    return { kind: 'frame', sandbox: IFRAME_SANDBOX };
  }
  return {
    kind: 'frame',
    sandbox: SANDBOX_PREVIEW_IFRAME_SANDBOX,
    allow: SANDBOX_PREVIEW_ALLOW,
  };
}
