import type { To } from 'react-router-dom';
import { isNonWorkspacePath } from './workspaceRootSegments';

function normalizeSameOriginPath(to: string): string {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(to)) return to;
  try {
    const url = new URL(to);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return to;
  }
  return to;
}

/**
 * Absolute paths are prefixed with `/{workspaceId}` so every navigation keeps the workspace
 * segment in the URL. Relative paths, paths that already carry the prefix and routes outside the
 * `/:workspaceId` layout are returned unchanged.
 */
export const prefixWorkspacePath = (to: To, workspaceId: string | undefined): To => {
  const normalizedTo = typeof to === 'string' ? normalizeSameOriginPath(to) : to;
  if (
    workspaceId &&
    typeof normalizedTo === 'string' &&
    normalizedTo.startsWith('/') &&
    !normalizedTo.startsWith(`/${workspaceId}`) &&
    !isNonWorkspacePath(normalizedTo)
  ) {
    return `/${workspaceId}${normalizedTo}`;
  }
  return normalizedTo;
};
