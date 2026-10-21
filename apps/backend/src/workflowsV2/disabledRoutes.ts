/**
 * SDK routes this backend never mounts, keyed `METHOD /path` as in `router.ts`.
 *
 * `POST /credentials/:name/test` sends a request to any URL the caller gives, with a
 * stored credential's auth attached, and returns the response. It resolves the
 * credential from `body.attributes` — which the browser sends — so a signed-in user could
 * name another workspace's credential and send its secret to a server they control. It
 * also checks no credential permission and accepts private addresses. Keep it off until
 * the SDK takes the workspace from the session and blocks private addresses.
 */
export const DISABLED_ROUTES: ReadonlySet<string> = new Set(['POST /credentials/:name/test']);
