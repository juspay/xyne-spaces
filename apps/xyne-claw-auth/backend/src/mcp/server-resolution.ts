import { prisma } from "../db.js";

/** Prefer an org's custom template; fall back to the platform template. */
export async function findMcpServer(type: string, orgId?: string | null) {
  if (orgId) {
    const owned = await prisma.mcpServer.findFirst({ where: { type, orgId } });
    if (owned) return owned;
  }
  return prisma.mcpServer.findFirst({ where: { type, orgId: null } });
}
