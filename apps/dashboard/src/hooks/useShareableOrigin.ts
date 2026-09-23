import { useParams } from 'react-router-dom';

/** Add the active workspace segment to a same-origin app URL when missing. */
export function withWorkspacePrefix(url: string, workspaceId?: string): string {
  if (!url || !workspaceId || typeof window === 'undefined') return url;

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return url;

    const prefix = `/${workspaceId}`;
    if (parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)) return url;

    // Already scoped to SOME workspace — adding ours on top produces
    // `/<ours>/<theirs>/chat/dir/...`, which no route matches and which
    // `parseInternalXyneLink` reads as `unknown` (no workspaceId), so the
    // cross-workspace switch is skipped too. Copying a link to another
    // workspace used to corrupt it exactly this way.
    // No app path segment reaches 20 characters, so this cannot swallow a real
    // route like `chat`, `newWindow` or `invite`.
    const [firstSegment] = parsed.pathname.split('/').filter(Boolean);
    if (firstSegment && /^[a-z0-9-]{20,}$/i.test(firstSegment)) return url;

    parsed.pathname = `${prefix}${parsed.pathname}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Returns the base URL to use when constructing shareable/copyable links.
 * Automatically includes the current workspace segment when inside `/:workspaceId` context.
 *
 * Usage:
 *   const shareableOrigin = useShareableOrigin();
 *   const link = `${shareableOrigin}/chat/dir/${channelId}`;
 */
export function useShareableOrigin(): string {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  return workspaceId ? `${window.location.origin}/${workspaceId}` : window.location.origin;
}
