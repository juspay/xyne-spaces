/**
 * Microsoft tenant → org binding. A Teams activity names the Entra tenant its
 * sender belongs to, signed by the Bot Connector; this is where that tenant
 * is turned into the one org allowed to answer it.
 *
 * An org admin binds a tenant once (routes.ts). Until then nothing from that
 * tenant reaches the core: no conversation reference is kept, no directory
 * lookup is made, no reply is sent. One tenant belongs to exactly one org, so
 * a sender is only ever matched against that org's users.
 */
import type { TeamsTenantBinding } from "@prisma/client";
import { prisma } from "../../db.js";
import { writeAuditLog } from "../../lib/audit.js";

export const TEAMS_SURFACE_ID = "teams";

/** The org a tenant is bound to, or null when no org has bound it. */
export async function orgForTenant(tenantId: string): Promise<string | null> {
  const row = await prisma.teamsTenantBinding.findUnique({
    where: { tenantId: tenantId.toLowerCase() },
    select: { orgId: true },
  });
  return row?.orgId ?? null;
}

export function listTenantBindings(orgId: string): Promise<TeamsTenantBinding[]> {
  return prisma.teamsTenantBinding.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
}

export type BindOutcome =
  | { ok: true; binding: TeamsTenantBinding; created: boolean }
  | { ok: false; reason: "bound_elsewhere" };

/** Bind a tenant to an org. Idempotent for the same org; never moves a
 *  tenant away from another org — that org has to unbind it first. */
export async function bindTenant(input: { tenantId: string; orgId: string; userId: string }): Promise<BindOutcome> {
  const tenantId = input.tenantId.toLowerCase();
  const existing = await prisma.teamsTenantBinding.findUnique({ where: { tenantId } });
  if (existing) {
    return existing.orgId === input.orgId ? { ok: true, binding: existing, created: false } : { ok: false, reason: "bound_elsewhere" };
  }
  let binding: TeamsTenantBinding;
  try {
    binding = await prisma.teamsTenantBinding.create({ data: { tenantId, orgId: input.orgId, boundByUserId: input.userId } });
  } catch (err) {
    // Lost a race on the unique tenantId: whoever won decides the answer.
    const winner = await prisma.teamsTenantBinding.findUnique({ where: { tenantId } });
    if (!winner) throw err;
    return winner.orgId === input.orgId ? { ok: true, binding: winner, created: false } : { ok: false, reason: "bound_elsewhere" };
  }
  await writeAuditLog({
    actorUserId: input.userId,
    eventType: "TEAMS_TENANT_BOUND",
    targetId: tenantId,
    description: "Bound a Microsoft tenant to the organization for Teams",
    metadata: { orgId: input.orgId, channel: "teams" },
  });
  return { ok: true, binding, created: true };
}

/**
 * Unbind a tenant from an org, and drop every Teams link of that tenant's
 * people in the org with it: a later rebind proves each of them again from
 * the directory rather than reviving links made under the old binding.
 */
export async function unbindTenant(input: {
  tenantId: string;
  orgId: string;
  userId: string;
}): Promise<{ removed: boolean; unlinked: number }> {
  const tenantId = input.tenantId.toLowerCase();
  const [bindings, identities] = await prisma.$transaction([
    prisma.teamsTenantBinding.deleteMany({ where: { tenantId, orgId: input.orgId } }),
    prisma.userSurfaceIdentity.deleteMany({
      where: { surfaceId: TEAMS_SURFACE_ID, orgId: input.orgId, surfaceUserId: { startsWith: `${tenantId}:` } },
    }),
  ]);
  if (bindings.count > 0 || identities.count > 0) {
    await writeAuditLog({
      actorUserId: input.userId,
      eventType: "TEAMS_TENANT_UNBOUND",
      targetId: tenantId,
      description: "Unbound a Microsoft tenant from the organization for Teams",
      metadata: { orgId: input.orgId, channel: "teams", unlinkedIdentities: identities.count },
    });
  }
  return { removed: bindings.count > 0, unlinked: identities.count };
}
