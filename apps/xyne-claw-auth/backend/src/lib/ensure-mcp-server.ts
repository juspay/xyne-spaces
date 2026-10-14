import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Find the `mcp_servers` row for `type`, creating it when missing. Replicas that
 * boot together can all see "missing" and race to create; the loser's insert fails
 * on the unique `type` and is resolved by re-reading the winner's row.
 */
export async function ensureMcpServer(type: string, data: Prisma.McpServerCreateInput) {
  const existing = await prisma.mcpServer.findUnique({ where: { type } });
  if (existing) return existing;
  try {
    return await prisma.mcpServer.create({ data });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await prisma.mcpServer.findUnique({ where: { type } });
    if (winner) return winner;
    throw err;
  }
}
