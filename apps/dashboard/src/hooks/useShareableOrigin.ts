import { useParams } from 'react-router-dom';

import { SHAREABLE_BASE_URL } from '../config';

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
 * Automatically includes the current workspace segment when inside
 * `/:workspaceId` context.
 *
 * The origin comes from the config-driven `SHAREABLE_BASE_URL` (a single source
 * of truth, env-overridable per environment) — NOT `window.location.origin` —
 * so shared links always point at the canonical public domain regardless of
 * which internal host actually served the page.
 *
 * Usage:
 *   const shareableOrigin = useShareableOrigin();
 *   const link = `${shareableOrigin}/chat/dir/${channelId}`;
 */
export function useShareableOrigin(): string {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  return workspaceId ? `${SHAREABLE_BASE_URL}/${workspaceId}` : SHAREABLE_BASE_URL;
}
