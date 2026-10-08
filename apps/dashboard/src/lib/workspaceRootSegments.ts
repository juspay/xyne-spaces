/**
 * The single source of truth for which first URL segments are *routes* rather
 * than workspace ids — i.e. the siblings of the `/:workspaceId` layout in
 * routes/AppRoot.tsx.
 *
 * MUST stay in sync with the top-level routes declared there. A segment missing
 * from this set breaks two unrelated things at once, which is why the fact lives
 * in exactly one place:
 *  - services/clients/authHeaders.ts sends the segment as `x-workspace-id`, and
 *    the backend resolver now answers 403 `workspace_forbidden` when the header
 *    names a workspace the account has no membership in — so every API call made
 *    from that route fails. It is no longer the silently ignored hint it once was.
 *  - lib/workspacePath.ts and components/ui/WorkspaceLink.tsx would rewrite
 *    `/<segment>` to `/<workspaceId>/<segment>`, sending navigations to a route
 *    that does not exist.
 *
 * Deliberately importless: authHeaders.ts is pulled in by apiClient/socketClient
 * at boot and documents that it depends on no React and no app state. Keeping the
 * set here rather than in lib/workspacePath.ts also avoids a cycle — workspacePath
 * type-imports 'react-router-dom', which vite aliases to lib/react-router-dom-shim
 * and which re-exports WorkspaceLink and useWorkspaceNavigate (both of which import
 * workspacePath back).
 *
 * 'api' is not a route; it is a defensive entry so an API path is never mistaken
 * for a workspace segment.
 */
export const NON_WORKSPACE_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  'newWindow',
  'call',
  'redirected',
  'calls',
  'invite',
  'community',
  'auth',
  'terms',
  'privacy',
  'sdk-sso',
  'workspaces',
  'no-access',
  'launch',
  'system',
  'api',
]);

/**
 * Segments that exist BOTH as a top-level route and as a child of `/:workspaceId`.
 * The two consumers of this module need different answers for them:
 *
 *  - authHeaders must still treat `/calls/<id>/detail` as a route, because the
 *    first segment is not a workspace id and sending `x-workspace-id: calls`
 *    is a 403.
 *  - prefixWorkspacePath must still PREFIX a bare `/calls...`, because the
 *    in-app destination is `/:workspaceId/calls`. Exempting it sent
 *    `/calls/<id>/detail` to the top-level `/calls/:callId/:callType` route
 *    (rendering CallPage with callType='detail' instead of CallDetailScreen)
 *    and `/calls?callId=` to nothing at all.
 *
 * `call` is the exception: `/call/:callId` has been prefix-exempt since before
 * this module existed (the standalone call window navigates to it absolutely,
 * through `router.navigate`, not the workspace-prefixing `useNavigate`), so
 * removing that exemption would be its own regression. It stays exempt.
 */
const ALSO_NESTED_UNDER_WORKSPACE: ReadonlySet<string> = new Set(['calls']);

/** True when `segment` names a top-level route, so it is not a workspace id. */
export function isNonWorkspaceRootSegment(segment: string): boolean {
  return NON_WORKSPACE_ROOT_SEGMENTS.has(segment);
}

/**
 * True when an absolute path (optionally carrying `?query`/`#hash`) targets a
 * top-level route and must therefore not be given a workspace prefix.
 *
 * Matches on the whole first segment rather than a string prefix, which is what
 * the old `'/call/'`-with-a-trailing-slash entries were approximating: `/callback`
 * is still not treated as `/call`, and `/authorize` is still not treated as
 * `/auth`, without needing a hand-maintained mix of `/x` and `/x/` spellings.
 *
 * Narrower than `isNonWorkspaceRootSegment` on purpose: a segment that is also a
 * child of `/:workspaceId` must keep getting the prefix. See
 * `ALSO_NESTED_UNDER_WORKSPACE`.
 */
export function isNonWorkspacePath(path: string): boolean {
  const firstSegment = path.match(/^\/([^/?#]+)/)?.[1];
  if (firstSegment === undefined) return false;
  if (ALSO_NESTED_UNDER_WORKSPACE.has(firstSegment)) return false;
  return NON_WORKSPACE_ROOT_SEGMENTS.has(firstSegment);
}
