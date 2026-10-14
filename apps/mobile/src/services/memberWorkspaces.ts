import { getWorkspaces, type WorkspaceItem } from './AuthServices';

/**
 * Process-wide cache of the workspaces the signed-in user belongs to.
 *
 * Two callers need this list and must not diverge: `useWorkspaces` (the profile
 * sheet's workspace switcher) and the deep-link workspace resolver, which runs
 * outside React and cannot use a hook. The cache is short-lived and read-through, so
 * a deep link arriving after the switcher has been opened costs no extra request.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { readonly loadedAtMs: number; readonly workspaces: WorkspaceItem[] } | null = null;
let inFlight: Promise<WorkspaceItem[]> | null = null;

/** Cached list, or `null` when nothing has been loaded or the entry has expired. */
export function getCachedMemberWorkspaces(nowMs: number = Date.now()): WorkspaceItem[] | null {
  if (!cache || nowMs - cache.loadedAtMs > CACHE_TTL_MS) return null;
  return cache.workspaces;
}

/**
 * Read-through load of the member workspace list. Concurrent callers share one
 * request; `force` bypasses the cache (used by an explicit refetch).
 */
export async function loadMemberWorkspaces(
  token: string,
  { force = false }: { force?: boolean } = {},
): Promise<WorkspaceItem[]> {
  if (!force) {
    const cached = getCachedMemberWorkspaces();
    if (cached) return cached;
    if (inFlight) return inFlight;
  }

  const request = getWorkspaces(token)
    .then(workspaces => {
      cache = { loadedAtMs: Date.now(), workspaces };
      return workspaces;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** Drop the cache when the identity behind it changes (sign-out, workspace switch). */
export function clearMemberWorkspacesCache(): void {
  cache = null;
  inFlight = null;
}
