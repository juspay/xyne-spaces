import type { Request } from "express";
import { prisma } from "../db.js";
import { getOrgId } from "../middleware/agent-acl.js";

export interface AdminOrgScope {
  allOrgs: boolean;
  orgId: string | undefined;
}

export function getAdminOrgScope(req: Request, endpoint: string, _allowAll = true): AdminOrgScope {
  // CLAW_ADMIN access is org-scoped: the cross-org `?orgScope=all` opt-in is
  // no longer honored. `requireClawAdmin` also strips the param, but this
  // hard-fails even for inline isClawAdmin callers that don't go through that
  // middleware. The `_allowAll` param is kept for signature compatibility but
  // has no effect.
  void _allowAll;
  void endpoint;
  const orgId = getOrgId(req);
  return { allOrgs: false, orgId };
}

export async function getOrgNameMap(orgIds: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const ids = Array.from(new Set(Array.from(orgIds).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();
  const orgs = await prisma.organization.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(orgs.map((org) => [org.id, org.name]));
}

export function withOrgLabel<T extends { orgId?: string | null }>(
  row: T,
  orgNames: Map<string, string>,
): T & { orgName?: string | null } {
  return {
    ...row,
    orgName: row.orgId ? (orgNames.get(row.orgId) ?? row.orgId) : null,
  };
}
