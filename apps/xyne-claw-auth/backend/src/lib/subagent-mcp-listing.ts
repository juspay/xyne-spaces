/**
 * Subagent-level MCP connections as a TOOL-LISTING source.
 *
 * `SubagentMcpConnection` rows were originally consumed only at call time
 * (credentials-loader pins them above the agent/user/global cascade). But when
 * an agent's ONLY credentials for a server live on its subagents, the server
 * never appeared in `GET /sessions/:id/mcp/tools`, so the run had no group to
 * resolve the subagent's palette from and the subagent was skipped entirely.
 *
 * This resolves the agent's configured custom subagents, loads their MCP
 * connections, and returns one listing entry per server type that is not
 * already reachable through a user/agent/global source. Precedence is
 * deliberately "existing sources win": the call-time pin already routes the
 * subagent's own calls to its own credentials.
 */

import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("subagent-mcp-listing");

export interface SubagentMcpListingEntry {
  serverType: string;
  serverName: string;
  instanceSlug: string;
  subagentDefinitionId: string;
  subagentName: string;
  credentials: Record<string, unknown>;
}

export async function loadSubagentMcpListingEntries(params: {
  orgId: string | undefined;
  subagentNames: readonly string[];
  existingServerTypes: ReadonlySet<string>;
}): Promise<SubagentMcpListingEntry[]> {
  const names = params.subagentNames
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.trim());
  if (names.length === 0) return [];

  const defs = await prisma.subagentDefinition.findMany({
    where: {
      name: { in: names },
      enabled: true,
      ...(params.orgId ? { orgId: params.orgId } : {}),
    },
    select: { id: true, name: true },
  });
  if (defs.length === 0) return [];

  const nameById = new Map(defs.map((d) => [d.id, d.name]));
  const conns = await prisma.subagentMcpConnection.findMany({
    where: { subagentDefinitionId: { in: defs.map((d) => d.id) } },
    include: { mcpServer: true },
    orderBy: [{ createdAt: "asc" }],
  });

  const out: SubagentMcpListingEntry[] = [];
  const claimed = new Set<string>(params.existingServerTypes);
  for (const conn of conns) {
    const server = conn.mcpServer;
    if (!server || server.enabled === false) continue;
    if (claimed.has(server.type)) continue;
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(
        decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey),
      ) as Record<string, unknown>;
    } catch {
      log.error(
        `[mcp/tools] subagent connection ${conn.id} (${server.type}) failed to decrypt — skipping listing`,
      );
      continue;
    }
    claimed.add(server.type);
    out.push({
      serverType: server.type,
      serverName: server.name,
      instanceSlug: conn.slug,
      subagentDefinitionId: conn.subagentDefinitionId,
      subagentName: nameById.get(conn.subagentDefinitionId) ?? "",
      credentials,
    });
  }
  return out;
}
