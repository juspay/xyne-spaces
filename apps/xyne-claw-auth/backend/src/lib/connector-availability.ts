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

export interface ConnectorAvailability {
  personal: Set<string>;
  org: Set<string>;
  agent: Set<string>;
}

export interface AgentScope {
  agentSlug?: string | undefined;
  agentOrgId?: string | null | undefined;
}

export async function availabilityForServerIds(
  userId: string,
  serverIds: string[],
  scope: AgentScope = {},
): Promise<ConnectorAvailability> {
  if (serverIds.length === 0) return { personal: new Set(), org: new Set(), agent: new Set() };

  const orgId =
    (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId ?? null;
  const agentOrgId = scope.agentOrgId ?? orgId;

  const [personal, shared, agentConns] = await Promise.all([
    prisma.userMcpConnection.findMany({
      where: { userId, mcpServerId: { in: serverIds } },
      select: { mcpServerId: true },
    }),
    prisma.mcpServer.findMany({
      where: {
        id: { in: serverIds },
        allowGlobalFallback: true,
        // Mirrors credentials-loader: this org's row, or the deployment-wide
        // default. Another org's row must not read as covered here.
        globalCredentials: {
          some: orgId ? { OR: [{ orgId }, { orgId: null }] } : { orgId: null },
        },
      },
      select: { id: true },
    }),
    scope.agentSlug && agentOrgId
      ? prisma.agentMcpConnection.findMany({
          where: { mcpServerId: { in: serverIds }, agent: { slug: scope.agentSlug, orgId: agentOrgId } },
          select: { mcpServerId: true },
        })
      : Promise.resolve([] as Array<{ mcpServerId: string }>),
  ]);

  return {
    personal: new Set(personal.map((c) => c.mcpServerId)),
    org: new Set(shared.map((s) => s.id)),
    agent: new Set(agentConns.map((c) => c.mcpServerId)),
  };
}

export async function availableServerTypes(
  userId: string,
  serverTypes: string[],
  scope: AgentScope = {},
): Promise<Set<string>> {
  if (serverTypes.length === 0) return new Set();

  const agentOrgId = scope.agentSlug
    ? scope.agentOrgId ??
      (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId ??
      null
    : null;

  const [personal, shared, agentConns] = await Promise.all([
    prisma.userMcpConnection.findMany({
      where: { userId, mcpServer: { type: { in: serverTypes } } },
      select: { mcpServer: { select: { type: true } } },
    }),
    prisma.mcpServer.findMany({
      where: { type: { in: serverTypes }, ...GLOBAL_FALLBACK_WHERE },
      select: { type: true },
    }),
    scope.agentSlug && agentOrgId
      ? prisma.agentMcpConnection.findMany({
          where: { mcpServer: { type: { in: serverTypes } }, agent: { slug: scope.agentSlug, orgId: agentOrgId } },
          select: { mcpServer: { select: { type: true } } },
        })
      : Promise.resolve([] as Array<{ mcpServer: { type: string } }>),
  ]);

  return new Set([
    ...personal.map((c) => c.mcpServer.type),
    ...shared.map((s) => s.type),
    ...agentConns.map((c) => c.mcpServer.type),
  ]);
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
  scope: AgentScope = {},
): Promise<Set<string> | null> {
  try {
    return await availableServerTypes(userId, serverTypes, scope);
  } catch (err) {
    log.warn(
      `availability lookup failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
