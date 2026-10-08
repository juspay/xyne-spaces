import { v4 as uuidv4 } from 'uuid';
import { APP_BASE_PATH } from '../../config';
import { isNonWorkspaceRootSegment } from '../../lib/workspaceRootSegments';
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
 * no app state) so any module can depend on it without an import cycle —
 * `lib/workspaceRootSegments` is itself importless for that reason.
 */

/**
 * Workspace id implied by the current URL. Main routes are /:workspaceId/..., so
 * the first segment is the workspace id *unless* it names a top-level route (see
 * lib/workspaceRootSegments) — then there is no workspace in the URL and we
 * return undefined rather than claiming a workspace named e.g. 'invite'.
 * Standalone /newWindow/* windows are the exception: they have no workspace
 * segment but do carry the id as a query param (then fall back to
 * lastActiveWorkspaceId), so that branch runs before the route-segment check.
 * The lane serves under the /sdlc-app basename, whose segment would otherwise
 * read as the workspace id. APP_BASE_PATH is '' in the main bundle.
 */
export function resolveWorkspaceIdFromLocation(): string | undefined {
  const path = window.location.pathname;
  const appPath = path.startsWith(APP_BASE_PATH) ? path.slice(APP_BASE_PATH.length) : path;
  const firstPathSegment = appPath.match(/^\/([^/]+)/)?.[1];
  if (!firstPathSegment) {
    return undefined;
  }
  if (firstPathSegment === 'newWindow') {
    const search = new URLSearchParams(window.location.search);
    const userEmail = logger.emailId || localStorage.getItem('user_email');
    return (
      search.get('workspaceId') ||
      (userEmail
        ? localStorage.getItem(`lastActiveWorkspaceId_${userEmail}`) || undefined
        : undefined)
    );
  }
  return isNonWorkspaceRootSegment(firstPathSegment) ? undefined : firstPathSegment;
}

/**
 * The workspace claim on its own: `{}` or `{ 'x-workspace-id': id }`. Pass
 * `workspaceId` when the call targets a workspace other than the one in the URL
 * (login/join/switch); otherwise it is resolved from the location.
 */
export function workspaceHeader(workspaceId?: string): Record<string, string> {
  const resolvedWorkspaceId = workspaceId || resolveWorkspaceIdFromLocation();
  return resolvedWorkspaceId ? { 'x-workspace-id': resolvedWorkspaceId } : {};
}

/**
 * Who/which-call headers, independent of the workspace being addressed:
 * x-request-id, x-client-id, x-zero-client-group-id, x-user-email,
 * x-client-session-id. A header is omitted when its value is unavailable;
 * x-request-id is always present because it is minted here per call.
 */
export function correlationHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  headers['x-request-id'] = uuidv4();

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

/**
 * The full set `apiClient` sets on every request — correlation headers plus the
 * workspace claim. Callers that need only one half can use the two leaf
 * functions above directly.
 */
export function buildAuthHeaders(workspaceId?: string): Record<string, string> {
  return { ...correlationHeaders(), ...workspaceHeader(workspaceId) };
}
