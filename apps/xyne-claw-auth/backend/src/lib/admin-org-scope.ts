import type { Request } from "express";
import { prisma } from "../db.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";

export interface AdminOrgScope {
  allOrgs: boolean;
  orgId: string | undefined;
}

export function getAdminOrgScope(req: Request, endpoint: string, allowAll = true): AdminOrgScope {
  const orgId = getOrgId(req);
  const allOrgs = allowAll && req.query["orgScope"] === "all";
  if (allOrgs) {
    const userId = getRequesterId(req) ?? "unknown";
    console.info("[admin-org-scope]", {
      userId,
      orgId: orgId ?? "unknown",
      endpoint,
      timestamp: new Date().toISOString(),
    });
  }
  return { allOrgs, orgId: allOrgs ? undefined : orgId };
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
