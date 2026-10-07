/**
 * Express Request augmentation for claw-auth.
 *
 * `req.user` is populated by `requireAuth` (middleware/require-auth.ts) when
 * the request carries a valid Spaces session cookie (`xs`, the opaque httpOnly
 * session token; `user_session_id` mirrors it for older clients) — the raw
 * `Cookie` plus `x-workspace-id` is forwarded to Spaces' `/api/auth/me`, which
 * answers with the user. Browsers no longer carry a `xyne_ws_<wid>_token` JWT;
 * when claw-auth itself needs to call Spaces as the user it mints one via
 * lib/spaces-auth.ts. The user is JIT-upserted into claw-auth's `users` table
 * on first hit and attached here for downstream handlers.
 *
 * For S2S calls (xyne-claw → claw-auth, identified by `x-s2s-key` header),
 * `req.user` is NOT set — handlers should either read identity from the
 * request body (e.g. `userId` parameter) or `req.headers["x-user-id"]`.
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        /** Spaces user id (matches public.users.id in the Spaces DB). */
        id: string;
        email: string;
        name: string;
        /** Workspace the user is currently scoped to (from `xyne_last_workspace`). */
        workspaceId?: string;
        /** Phase-1 org context (set alongside the `x-org-id` header by requireAuth). */
        orgId?: string;
        /** OrgMember role in `orgId`: OWNER | ADMIN | MEMBER. */
        role?: string;
      };
    }
  }
}

export {};
