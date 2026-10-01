import { SUBAGENT_DEFINITIONS, type AgentToolsConfig } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { parseGatewayToolSelectionKey } from "../mcpgateway/key-format.js";
import { isVisibleToUser, parseConnectorMeta } from "./connector-visibility.js";

/**
 * What a run can and cannot reach among the deployment's MCP connectors.
 *
 * Two questions the agent could not answer before, because its tool list only
 * ever contained connectors with working credentials:
 *
 *   1. "My config selects Grafana tools — why don't I have them?" A server the
 *      agent's selection grants but that has no credential path for this user
 *      (or failed to load) was dropped silently. `findUnresolvedConfiguredServers`
 *      names those so the run can tell the agent to offer the connection.
 *   2. "Does a tool for this exist here at all?" Deployment-wide tool search
 *      returns every indexed tool; `visibleConnectors` lets the search route
 *      mark each one connected / not connected for THIS session.
 */

/** Listing-only server types that are not user-connectable connectors. */
const NON_CONNECTOR_SERVER_TYPES: ReadonlySet<string> = new Set(["knowledge-base", "claw-builtin"]);

/** Tools named per unresolved server — enough to recognise it, bounded for the prompt. */
const MAX_TOOLS_PER_SERVER = 25;

export interface VisibleConnector {
  type: string;
  name: string;
  description: string;
}

/** Enabled connectors this user is allowed to see (connectorMeta visibility). */
export async function visibleConnectors(userId: string): Promise<VisibleConnector[]> {
  const rows = await prisma.mcpServer.findMany({
    where: { enabled: true },
    select: { type: true, name: true, description: true, connectorMeta: true },
    orderBy: { name: "asc" },
  });
  return rows
    .filter((row) => !NON_CONNECTOR_SERVER_TYPES.has(row.type))
    .filter((row) => isVisibleToUser(parseConnectorMeta(row.connectorMeta), userId))
    .map((row) => ({ type: row.type, name: row.name, description: row.description ?? "" }));
}

export interface UnresolvedConfiguredServer {
  serverType: string;
  serverName: string;
  /**
   * `not_connected` — no credential path for this user/agent: the fix is the
   *                   user connecting it (a connector card).
   * `unavailable`   — credentials exist but the server failed to load this run.
   */
  reason: "not_connected" | "unavailable";
  /** True when the selection grants the whole server (its subagent wrapper). */
  wholeServer: boolean;
  /** Tool names the selection grants there. For a whole server, its indexed
   *  tools — possibly empty when nobody has connected it yet. Capped. */
  tools: string[];
  /** Tools beyond `tools` that the cap left out. */
  moreTools: number;
}

/** Lowercase, alphanumerics only: `Xyne_Spaces_App_Tools` ≡ `xyne-spaces-app-tools`. */
function normKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * MCP connectors the agent's stored selection grants, keyed by server type.
 * Subagent picks grant a whole server; direct picks grant single tools
 * (`grafana__query_prometheus`, or a bare name resolved through the index).
 * Gateway picks and custom (in-process) tools are not connectors and are skipped.
 */
async function configuredServers(
  config: AgentToolsConfig,
  connectors: VisibleConnector[],
  resolvedServerTypes: ReadonlySet<string>,
): Promise<Map<string, { wholeServer: boolean; tools: Set<string> }>> {
  const byKey = new Map<string, VisibleConnector>();
  for (const c of connectors) {
    byKey.set(normKey(c.type), c);
    byKey.set(normKey(c.name), c);
  }
  const knownTypes = new Set(connectors.map((c) => c.type));
  const out = new Map<string, { wholeServer: boolean; tools: Set<string> }>();
  const slot = (type: string) => {
    let entry = out.get(type);
    if (!entry) {
      entry = { wholeServer: false, tools: new Set() };
      out.set(type, entry);
    }
    return entry;
  };

  for (const name of config.subagents ?? []) {
    if (typeof name !== "string" || !name) continue;
    const types = SUBAGENT_DEFINITIONS.filter((d) => d.name === name).map((d) => d.serverType);
    if (types.length === 0 && knownTypes.has(name)) types.push(name);
    for (const type of types) {
      if (knownTypes.has(type)) slot(type).wholeServer = true;
    }
  }

  const bare: string[] = [];
  for (const entry of config.direct ?? []) {
    if (typeof entry !== "string" || !entry) continue;
    if (parseGatewayToolSelectionKey(entry)) continue;
    const sep = entry.indexOf("__");
    if (sep > 0) {
      const connector = byKey.get(normKey(entry.slice(0, sep)));
      if (connector) slot(connector.type).tools.add(entry.slice(sep + 2));
      continue;
    }
    bare.push(entry);
  }
  if (bare.length > 0) {
    const rows = await prisma.tool.findMany({
      where: { name: { in: bare }, source: { startsWith: "mcp:" } },
      select: { name: true, source: true },
    });
    // A bare name can exist on several servers (`spaces-whoami` is on both
    // xyne-spaces and xyne-spaces-app-tools). The pick is satisfied when ANY of
    // them resolved; otherwise it is charged to one server, in a stable order.
    const candidates = new Map<string, string[]>();
    for (const row of rows) {
      const type = row.source.slice("mcp:".length);
      if (!knownTypes.has(type)) continue;
      candidates.set(row.name, [...(candidates.get(row.name) ?? []), type]);
    }
    for (const [name, types] of candidates) {
      if (types.some((type) => resolvedServerTypes.has(type))) continue;
      const [first] = [...types].sort();
      if (first) slot(first).tools.add(name);
    }
  }
  return out;
}

/**
 * Servers the agent's selection grants that did NOT make it into this run's
 * listing. `resolvedServerTypes` is what the listing returned; a type with a
 * credential path (`credentialedServerTypes`) that still failed to list is
 * `unavailable`, anything else is `not_connected`.
 */
export async function findUnresolvedConfiguredServers(args: {
  userId: string;
  config: AgentToolsConfig;
  resolvedServerTypes: ReadonlySet<string>;
  credentialedServerTypes: ReadonlySet<string>;
}): Promise<UnresolvedConfiguredServer[]> {
  const connectors = await visibleConnectors(args.userId);
  const configured = await configuredServers(args.config, connectors, args.resolvedServerTypes);
  const missing = [...configured.entries()].filter(([type]) => !args.resolvedServerTypes.has(type));
  if (missing.length === 0) return [];

  const wholeTypes = missing.filter(([, v]) => v.wholeServer).map(([type]) => type);
  const indexed = wholeTypes.length
    ? await prisma.tool.findMany({
        where: { source: { in: wholeTypes.map((t) => `mcp:${t}`) }, enabled: true },
        select: { name: true, source: true },
        orderBy: { name: "asc" },
      })
    : [];
  const indexedByType = new Map<string, string[]>();
  for (const row of indexed) {
    const type = row.source.slice("mcp:".length);
    indexedByType.set(type, [...(indexedByType.get(type) ?? []), row.name]);
  }
  const nameOf = new Map(connectors.map((c) => [c.type, c.name]));

  return missing
    .map(([type, v]) => {
      const all = [...new Set([...(v.wholeServer ? (indexedByType.get(type) ?? []) : []), ...v.tools])].sort();
      return {
        serverType: type,
        serverName: nameOf.get(type) ?? type,
        reason: args.credentialedServerTypes.has(type) ? ("unavailable" as const) : ("not_connected" as const),
        wholeServer: v.wholeServer,
        tools: all.slice(0, MAX_TOOLS_PER_SERVER),
        moreTools: Math.max(0, all.length - MAX_TOOLS_PER_SERVER),
      };
    })
    .sort((a, b) => a.serverType.localeCompare(b.serverType));
}
