/**
 * Express Request augmentation for claw-auth.
 *
 * `req.user` is populated by `requireAuth` (middleware/require-auth.ts) when
 * the request carries a valid Spaces session cookie (`xyne_ws_<wid>_token`
 * + `xyne_last_workspace`). The user is JIT-upserted into claw-auth's `users`
 * table on first hit and attached here for downstream handlers.
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
