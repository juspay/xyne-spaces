/** Durable per-workspace last-visited SDLC path; frameLocationRef is memory-only. */

const KEY_PREFIX = 'sdlc:last-location:';

/** Extracts the hub (channel) id from an SDLC path; null for bare roots and non-SDLC paths. */
export function sdlcHubIdOf(path: string): string | null {
  return path.match(/^\/[^/]+\/sdlc\/([^/?#]+)/)?.[1] ?? null;
}

/** Drops the frame-reset cache-bust so it never lands in durable state or the address bar. */
export function withoutResetParam(path: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.delete('_reset');
  return `${url.pathname}${url.search}${url.hash}`;
}

function keyFor(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`;
}

export function getLastSdlcLocation(workspaceId: string): string | null {
  try {
    const value = localStorage.getItem(keyFor(workspaceId));
    if (!value || !sdlcHubIdOf(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function setLastSdlcLocation(workspaceId: string, path: string): void {
  if (!sdlcHubIdOf(path)) return;
  try {
    localStorage.setItem(keyFor(workspaceId), path);
  } catch {
    // Storage full or blocked — resume stays session-only.
  }
}
