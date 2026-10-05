import { v4 as uuidv4 } from 'uuid';
import { APP_BASE_PATH } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Leaf module: the per-request auth/correlation headers the dashboard attaches to
 * every backend call. `apiClient`'s request interceptor uses it, and so must every
 * call that bypasses `apiClient` (plain `axios`/`fetch` with cookies, socket.io
 * handshake). The server no longer rewrites the `xyne_last_workspace` hint on
 * auto-refresh, so a bypass call without `x-workspace-id` can resolve against the
 * wrong workspace — the header is what picks the workspace for the session.
 *
 * Deliberately imports nothing beyond what `apiClient` already pulls in (no React,
 * no app state) so any module can depend on it without an import cycle.
 */

/**
 * Workspace id implied by the current URL. Main routes are /:workspaceId/...;
 * standalone /newWindow/* windows carry it as a query param (then fall back to
 * lastActiveWorkspaceId). The lane serves under the /sdlc-app basename, whose
 * segment would otherwise read as the workspace id. APP_BASE_PATH is '' in the
 * main bundle. Returns undefined for the non-workspace routes (/auth, /sdk-sso).
 */
export function resolveWorkspaceIdFromLocation(): string | undefined {
  const path = window.location.pathname;
  const appPath = path.startsWith(APP_BASE_PATH) ? path.slice(APP_BASE_PATH.length) : path;
  const firstPathSegment = appPath.match(/^\/([^/]+)/)?.[1];
  let workspaceId: string | undefined = firstPathSegment;
  if (firstPathSegment === 'newWindow') {
    const search = new URLSearchParams(window.location.search);
    const userEmail = logger.emailId || localStorage.getItem('user_email');
    workspaceId =
      search.get('workspaceId') ||
      (userEmail
        ? localStorage.getItem(`lastActiveWorkspaceId_${userEmail}`) || undefined
        : undefined);
  }
  if (workspaceId && workspaceId !== 'auth' && workspaceId !== 'sdk-sso') {
    return workspaceId;
  }
  return undefined;
}

/**
 * Headers `apiClient` sets on every request: x-workspace-id, x-request-id,
 * x-client-id, x-zero-client-group-id, x-user-email, x-client-session-id.
 * A header is omitted when its value is unavailable. Pass `workspaceId` when the
 * call targets a workspace other than the one in the URL (login/join/switch);
 * otherwise it is resolved from the location.
 */
export function buildAuthHeaders(workspaceId?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  headers['x-request-id'] = uuidv4();

  const resolvedWorkspaceId = workspaceId || resolveWorkspaceIdFromLocation();
  if (resolvedWorkspaceId) {
    headers['x-workspace-id'] = resolvedWorkspaceId;
  }

  const zeroClientId = logger.zeroClientId;
  if (zeroClientId) {
    headers['x-client-id'] = zeroClientId;
  }
  const zeroClientGroupId = logger.zeroClientGroupId;
  if (zeroClientGroupId) {
    headers['x-zero-client-group-id'] = zeroClientGroupId;
  }
  const userEmail = logger.emailId;
  if (userEmail) {
    headers['x-user-email'] = userEmail;
  }
  const clientSessionId = logger.clientSessionId;
  if (clientSessionId) {
    headers['x-client-session-id'] = clientSessionId;
  }
  return headers;
}
