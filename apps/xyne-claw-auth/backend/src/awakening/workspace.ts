/**
 * Resolves which Spaces workspace an awakened agent reads and acts in.
 *
 * Every Spaces query is tenant-scoped, so a wrong or empty workspaceId either
 * fails the ACL check or — worse — reads the wrong tenant. The mapping lives
 * in SurfaceTenantLink (orgId ↔ Spaces workspaceId).
 *
 * An org with exactly one linked workspace resolves automatically, which is
 * the common case. An org with several MUST pin one in
 * `config.awakening.workspaceId`: guessing between tenants is exactly the
 * mistake that must never happen silently, so this throws instead.
 */

import { prisma } from "../db.js";

export class WorkspaceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceResolutionError";
  }
}

export async function resolveWorkspaceId(orgId: string, configured?: string): Promise<string> {
  const links = await prisma.surfaceTenantLink.findMany({
    where: { orgId, surfaceType: "spaces" },
    select: { surfaceTenantId: true },
    orderBy: { createdAt: "asc" },
  });

  if (configured) {
    const known = links.some((l) => l.surfaceTenantId === configured);
    if (!known) {
      throw new WorkspaceResolutionError(
        `configured workspaceId "${configured}" is not linked to this org`,
      );
    }
    return configured;
  }

  const first = links[0]?.surfaceTenantId;
  if (links.length === 0 || !first) {
    throw new WorkspaceResolutionError("no Spaces workspace is linked to this org");
  }
  if (links.length > 1) {
    throw new WorkspaceResolutionError(
      `org has ${links.length} linked Spaces workspaces; set config.awakening.workspaceId to pick one`,
    );
  }
  return first;
}
