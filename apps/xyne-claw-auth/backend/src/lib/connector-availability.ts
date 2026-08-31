import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("connector-availability");

const GLOBAL_FALLBACK_WHERE = {
  allowGlobalFallback: true,
  globalCredentials: { some: {} },
} as const;

export async function availableServerIds(
  userId: string,
  serverIds: string[],
): Promise<Set<string>> {
  if (serverIds.length === 0) return new Set();

  const [personal, shared] = await Promise.all([
    prisma.userMcpConnection.findMany({
      where: { userId, mcpServerId: { in: serverIds } },
      select: { mcpServerId: true },
    }),
    prisma.mcpServer.findMany({
      where: { id: { in: serverIds }, ...GLOBAL_FALLBACK_WHERE },
      select: { id: true },
    }),
  ]);

  return new Set([...personal.map((c) => c.mcpServerId), ...shared.map((s) => s.id)]);
}

export async function availableServerTypes(
  userId: string,
  serverTypes: string[],
): Promise<Set<string>> {
  if (serverTypes.length === 0) return new Set();

  const [personal, shared] = await Promise.all([
    prisma.userMcpConnection.findMany({
      where: { userId, mcpServer: { type: { in: serverTypes } } },
      select: { mcpServer: { select: { type: true } } },
    }),
    prisma.mcpServer.findMany({
      where: { type: { in: serverTypes }, ...GLOBAL_FALLBACK_WHERE },
      select: { type: true },
    }),
  ]);

  return new Set([...personal.map((c) => c.mcpServer.type), ...shared.map((s) => s.type)]);
}

export async function availableServerIdsSafe(
  userId: string,
  serverIds: string[],
): Promise<Set<string> | null> {
  try {
    return await availableServerIds(userId, serverIds);
  } catch (err) {
    log.warn(
      `availability lookup failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function availableServerTypesSafe(
  userId: string,
  serverTypes: string[],
): Promise<Set<string> | null> {
  try {
    return await availableServerTypes(userId, serverTypes);
  } catch (err) {
    log.warn(
      `availability lookup failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
