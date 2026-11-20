/**
 * A link that points inside this Spaces app (same origin, or an app-relative path such as
 * "/<workspace>/chat/canvas/<id>") — returns the in-app path to navigate to, else null.
 * Used so canvas-to-canvas links open in place instead of a new browser tab.
 */
export function inAppPath(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
