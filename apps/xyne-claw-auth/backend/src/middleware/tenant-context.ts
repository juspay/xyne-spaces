import type { Request } from "express";

/**
 * Tenant context (phase 1, org-only).
 *
 * `x-user-id`, `x-org-id`, and `x-user-role` are set by `requireAuth`
 * (require-auth.ts) after it resolves the claw User from the Spaces session and
 * looks up the user's org + role. Reading them here keeps handlers decoupled
 * from how auth resolved the request.
 *
 * NOTE: `requireAuth`, `requireS2S`, and `requireUserAuth` all attach org
 * context now (via the `attachOrgContext` call sites in require-auth.ts).
 * `requireStrictS2S` / `requireInternalS2S` still attach none — they carry no
 * user identity, so there is no org to resolve.
 */
export interface TenantContext {
  userId: string;
  orgId: string;
  role: string;
}

export function getTenantContext(req: Request): TenantContext {
  return {
    userId: (req.headers["x-user-id"] as string) ?? "",
    orgId: (req.headers["x-org-id"] as string) ?? "",
    role: (req.headers["x-user-role"] as string) ?? "",
  };
}

/**
 * For just the org id, use `getOrgId` from `agent-acl.ts` (canonical accessor,
 * returns `string | undefined`). Not re-exported here to avoid two variants.
 */

/** Just the claw user id from the request (empty string if unresolved). */
export function getClawUserId(req: Request): string {
  return (req.headers["x-user-id"] as string) ?? "";
}
