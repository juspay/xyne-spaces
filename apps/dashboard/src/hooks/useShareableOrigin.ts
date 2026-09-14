import { useParams } from 'react-router-dom';

/**
 * The dashboard is served from `app.spaces[.sandbox].xyne.juspay.net`, but the
 * mobile app only claims the app-less host (`spaces[.sandbox].xyne.juspay.net`)
 * for iOS Universal Links / Android App Links. A shared link built on the
 * `app.` host is not a registered universal-link host, so the OS opens it in the
 * browser instead of routing it into the app. Normalising the origin to the
 * canonical host keeps copied links openable in the mobile app.
 *
 * Hosts that are not `app.spaces.*` (e.g. `localhost:5173` in dev) are returned
 * unchanged.
 */
export function canonicalShareOrigin(): string {
  if (typeof window === 'undefined') return 'https://spaces.xyne.juspay.net';

  const { protocol, host } = window.location;
  const canonicalHost = host.startsWith('app.spaces.') ? host.slice('app.'.length) : host;
  return `${protocol}//${canonicalHost}`;
}

/** Add the active workspace segment to a same-origin app URL when missing. */
export function withWorkspacePrefix(url: string, workspaceId?: string): string {
  if (!url || !workspaceId || typeof window === 'undefined') return url;

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return url;

    const prefix = `/${workspaceId}`;
    if (parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)) return url;

    parsed.pathname = `${prefix}${parsed.pathname}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Returns the base URL to use when constructing shareable/copyable links.
 * Uses the canonical (app-less) host so links open in the mobile app, and
 * automatically includes the current workspace segment when inside
 * `/:workspaceId` context.
 *
 * Usage:
 *   const shareableOrigin = useShareableOrigin();
 *   const link = `${shareableOrigin}/chat/dir/${channelId}`;
 */
export function useShareableOrigin(): string {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const origin = canonicalShareOrigin();
  return workspaceId ? `${origin}/${workspaceId}` : origin;
}
