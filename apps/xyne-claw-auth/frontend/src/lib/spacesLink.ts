/**
 * Helpers for linking back into the Xyne Spaces dashboard from Claw.
 *
 * Spaces routes are mounted under a `/:workspaceId/*` layout (see
 * xyne-spaces/apps/dashboard/src/routes/AppRoot.tsx). A cold page load in a new
 * tab at `/chat/dir/:channelId/:conversationId` therefore does NOT match any
 * route and fails — the in-app anchor fallback that prepends the default
 * workspace only runs for same-origin SPA clicks, not fresh tab loads.
 *
 * The workspace pointer cookie (`xyne_last_workspace`) is set `httpOnly` by the
 * Spaces backend, so the browser can't read it via `document.cookie` — the old
 * cookie-based lookup always returned "". We instead cache the workspaceId from
 * the authenticated user (GET /api/auth/validate, via getMe/useAuth) and use it
 * to build every Spaces thread link.
 */

const SPACES_APP_URL =
  import.meta.env.VITE_SPACES_APP_URL ||
  import.meta.env.VITE_XYNE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://localhost:5173" : window.location.origin);

let cachedWorkspaceId = "";

/** Populate the cached workspaceId from the authenticated user (call after getMe). */
export function setSpacesWorkspaceId(id: string | null | undefined): void {
  if (id) cachedWorkspaceId = id;
}

export function getSpacesWorkspaceId(): string {
  return cachedWorkspaceId;
}

/**
 * Build a link to a Spaces conversation thread, including the `/:workspaceId`
 * segment the dashboard router requires. Falls back to the workspace-less path
 * only when the id is unknown (better than nothing, still hits the in-app
 * default-workspace fallback for same-origin navigations).
 */
export function spacesThreadUrl(channelId: string, conversationId: string): string {
  const base = cachedWorkspaceId ? `${SPACES_APP_URL}/${cachedWorkspaceId}` : SPACES_APP_URL;
  return `${base}/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
}
