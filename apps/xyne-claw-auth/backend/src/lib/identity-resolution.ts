/**
 * Shared Spaces → Claw person-resolution policy ("identity merge").
 *
 * Person resolution is EMAIL-PRIMARY (deliberate product choice): within an
 * org, (email, orgId) is the per-person uniqueness invariant Spaces data
 * satisfies in this deployment. Spaces' person key (`org_members` id) is
 * stored only on UserSurfaceIdentity rows (via `surfaceMemberId`) and used
 * here purely as a protective rail around email matching:
 *
 *   1. A member claim linked to multiple Claw users       → refuse
 *   2. Member claim and exact-id row disagree             → refuse
 *   3. Member claim and email-primary row disagree        → refuse
 *   4. Email-primary row already claims OTHER member(s)   → refuse
 *   5. Exact-id row lives in another org                  → refuse
 *   6. Exact-id row and email-primary row disagree        → refuse
 *
 * Refusal is fail-closed and never a silent merge. Callers map a refusal to
 * their own contract: the spaces-sync route answers HTTP 409, the JIT mirror
 * (users-jit.ts) treats it as a hard miss.
 *
 * Both entry points (the provisioning route and the request-time JIT mirror)
 * MUST share this policy so merge decisions can never diverge. Accepts either
 * the app client or a transaction client so the route can stay transactional.
 */

import type { AppPrismaClient, AppTransactionClient } from "../db.js";

type DbClient = AppPrismaClient | AppTransactionClient;

export interface SurfacePersonInput {
  /** Claw org the person must belong to. */
  orgId: string;
  /** Normalized (trimmed/lower-cased) email from the surface profile. */
  email: string;
  /**
   * The surface user id as a possible exact Claw `users.id` (legacy mirror
   * rows used the raw workspace-scoped id as their primary key).
   */
  exactUserId?: string | undefined;
  /** Spaces `org_members` member-id claim, when the payload carries it. */
  memberId?: string | undefined;
}

export type SurfacePersonResolution =
  | { kind: "create" }
  | { kind: "reuse"; userId: string }
  | { kind: "refused"; reason: string };

export async function resolveSurfacePerson(
  client: DbClient,
  input: SurfacePersonInput,
): Promise<SurfacePersonResolution> {
  const exactUser = input.exactUserId
    ? await client.user.findUnique({
        where: { id: input.exactUserId },
        select: { id: true, orgId: true },
      })
    : null;
  const emailUser = await client.user.findFirst({
    where: { orgId: input.orgId, email: { equals: input.email, mode: "insensitive" } },
    select: { id: true },
  });

  const memberIdentityUserIds = input.memberId
    ? [...new Set(
        (await client.userSurfaceIdentity.findMany({
          where: {
            surfaceId: "spaces",
            orgId: input.orgId,
            surfaceMemberId: input.memberId,
            userId: { not: null },
          },
          select: { userId: true },
        })).map((row) => row.userId as string),
      )]
    : [];
  if (memberIdentityUserIds.length > 1) {
    return {
      kind: "refused",
      reason: `Spaces org member ${input.memberId} is linked to multiple Claw users: ${memberIdentityUserIds.join(", ")}`,
    };
  }
  const memberUserId = memberIdentityUserIds[0];
  if (memberUserId && exactUser && memberUserId !== exactUser.id) {
    return {
      kind: "refused",
      reason: `Spaces org member ${input.memberId} resolves to Claw user ${memberUserId}, but workspace user ${input.exactUserId} resolves to ${exactUser.id}`,
    };
  }
  if (memberUserId && emailUser && memberUserId !== emailUser.id) {
    return {
      kind: "refused",
      reason: `Spaces org member ${input.memberId} resolves to Claw user ${memberUserId}, but email ${input.email} resolves to ${emailUser.id} in org ${input.orgId}`,
    };
  }
  if (input.memberId && emailUser && !memberUserId) {
    // The email-matched person already claims OTHER members in this org: a
    // same-email/different-person collision. Refuse rather than merge.
    const knownMembers = await client.userSurfaceIdentity.findMany({
      where: {
        surfaceId: "spaces",
        orgId: input.orgId,
        userId: emailUser.id,
        surfaceMemberId: { not: null },
      },
      select: { surfaceMemberId: true },
      distinct: ["surfaceMemberId"],
    });
    if (knownMembers.length > 0) {
      return {
        kind: "refused",
        reason: `Email ${input.email} in org ${input.orgId} already belongs to distinct member(s) ` +
          `${knownMembers.map((row) => row.surfaceMemberId).join(", ")}; received ${input.memberId} — refusing merge`,
      };
    }
  }

  if (exactUser && exactUser.orgId !== input.orgId) {
    return {
      kind: "refused",
      reason: `Claw user id ${input.exactUserId} already belongs to org ${exactUser.orgId}; Spaces says ${input.orgId}`,
    };
  }
  if (exactUser && emailUser && exactUser.id !== emailUser.id) {
    return {
      kind: "refused",
      reason: `Spaces user ${input.exactUserId} conflicts with existing Claw user ${emailUser.id} for ${input.email} in org ${input.orgId}`,
    };
  }

  const canonicalUserId = memberUserId ?? exactUser?.id ?? emailUser?.id;
  return canonicalUserId ? { kind: "reuse", userId: canonicalUserId } : { kind: "create" };
}
