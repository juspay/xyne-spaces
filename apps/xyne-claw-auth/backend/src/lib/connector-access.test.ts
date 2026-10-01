import { beforeEach, describe, expect, it, vi } from "vitest";

const servers = [
  { type: "grafana", name: "Grafana", description: "metrics", connectorMeta: null },
  { type: "xyne-spaces", name: "Xyne Spaces", description: "spaces", connectorMeta: null },
  { type: "xyne-spaces-app-tools", name: "Xyne Spaces App Tools", description: "app", connectorMeta: null },
  { type: "kibana", name: "Kibana", description: "logs", connectorMeta: null },
  { type: "hidden", name: "Hidden", description: "", connectorMeta: { hidden: true } },
];
const toolRows = [
  { name: "query_prometheus", source: "mcp:grafana" },
  { name: "list_dashboards", source: "mcp:grafana" },
  { name: "spaces-whoami", source: "mcp:xyne-spaces" },
  { name: "spaces-whoami", source: "mcp:xyne-spaces-app-tools" },
];

const mcpServerFindMany = vi.fn(async () => servers);
const toolFindMany = vi.fn(async (args: { where: { name?: { in: string[] }; source?: { in: string[] } } }) => {
  if (args.where.name) return toolRows.filter((r) => args.where.name!.in.includes(r.name));
  if (args.where.source) return toolRows.filter((r) => args.where.source!.in.includes(r.source));
  return [];
});

vi.mock("../db.js", () => ({ prisma: { mcpServer: { findMany: mcpServerFindMany }, tool: { findMany: toolFindMany } } }));
vi.mock("./connector-visibility.js", () => ({
  parseConnectorMeta: (v: unknown) => (v ?? {}) as Record<string, unknown>,
  isVisibleToUser: (meta: { hidden?: boolean }) => !meta.hidden,
}));
vi.mock("../mcpgateway/key-format.js", () => ({
  parseGatewayToolSelectionKey: (key: string) => (key.startsWith("gw:") ? { serviceName: "x" } : null),
}));

const { findUnresolvedConfiguredServers } = await import("./connector-access.js");

beforeEach(() => {
  toolFindMany.mockClear();
});

describe("findUnresolvedConfiguredServers", () => {
  it("names a selected server with no credential path as not connected, with its indexed tools", async () => {
    const out = await findUnresolvedConfiguredServers({
      userId: "u1",
      config: { subagents: ["grafana"] },
      resolvedServerTypes: new Set(["xyne-spaces"]),
      credentialedServerTypes: new Set(["xyne-spaces"]),
    });
    expect(out).toEqual([
      {
        serverType: "grafana",
        serverName: "Grafana",
        reason: "not_connected",
        wholeServer: true,
        tools: ["list_dashboards", "query_prometheus"],
        moreTools: 0,
      },
    ]);
  });

  it("reports a credentialed server that failed to list as unavailable", async () => {
    const out = await findUnresolvedConfiguredServers({
      userId: "u1",
      config: { direct: ["kibana__search_logs"] },
      resolvedServerTypes: new Set(),
      credentialedServerTypes: new Set(["kibana"]),
    });
    expect(out).toMatchObject([{ serverType: "kibana", reason: "unavailable", wholeServer: false, tools: ["search_logs"] }]);
  });

  it("treats a bare pick as satisfied when any server exposing it resolved", async () => {
    const out = await findUnresolvedConfiguredServers({
      userId: "u1",
      config: { direct: ["spaces-whoami"] },
      resolvedServerTypes: new Set(["xyne-spaces"]),
      credentialedServerTypes: new Set(["xyne-spaces", "xyne-spaces-app-tools"]),
    });
    expect(out).toEqual([]);
  });

  it("matches human-cased prefixes and ignores resolved, hidden and gateway picks", async () => {
    const out = await findUnresolvedConfiguredServers({
      userId: "u1",
      config: { direct: ["Grafana__query_prometheus", "Xyne_Spaces__spaces-whoami", "gw:svc:tool", "hidden__x"] },
      resolvedServerTypes: new Set(["xyne-spaces"]),
      credentialedServerTypes: new Set(),
    });
    expect(out.map((u) => u.serverType)).toEqual(["grafana"]);
    expect(out[0]!.tools).toEqual(["query_prometheus"]);
  });

  it("returns nothing when every selected server resolved", async () => {
    const out = await findUnresolvedConfiguredServers({
      userId: "u1",
      config: { subagents: ["grafana"], direct: ["spaces-whoami"] },
      resolvedServerTypes: new Set(["grafana", "xyne-spaces"]),
      credentialedServerTypes: new Set(["grafana", "xyne-spaces"]),
    });
    expect(out).toEqual([]);
  });
});
