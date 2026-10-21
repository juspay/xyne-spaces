import { describe, expect, it } from "vitest";
import {
  buildFastModeMetaTools,
  renderUnresolvedConfigured,
  type DeploymentSearchResult,
  type DeploymentToolMatch,
  type UnresolvedConfiguredServer,
} from "../src/tool-catalog.js";

const match = (over: Partial<DeploymentToolMatch>): DeploymentToolMatch => ({
  slug: "x",
  name: "x",
  integration: "x",
  description: "desc",
  risk: "read",
  params: [],
  ...over,
});

const grafanaUnresolved: UnresolvedConfiguredServer = {
  serverType: "grafana",
  serverName: "Grafana",
  reason: "not_connected",
  wholeServer: true,
  tools: [],
  moreTools: 0,
};

function searchTool(opts: {
  result?: DeploymentSearchResult;
  unresolvedConfigured?: UnresolvedConfiguredServer[];
  suggestConnectorsAvailable?: boolean;
  runToolNames?: string[];
  mcpServers?: Array<{ serverType: string; serverName: string; tools: number }>;
}) {
  const tools = buildFastModeMetaTools({
    catalog: [],
    controller: {},
    ...(opts.result ? { searchDeployment: async () => opts.result! } : {}),
    ...(opts.unresolvedConfigured ? { unresolvedConfigured: opts.unresolvedConfigured } : {}),
    suggestConnectorsAvailable: opts.suggestConnectorsAvailable ?? true,
    ...(opts.runToolNames ? { runToolNames: opts.runToolNames } : {}),
    mcpServers: opts.mcpServers ?? [{ serverType: "google", serverName: "Google", tools: 3 }],
  });
  const def = tools.find((t) => t.name === "search-tools")! as unknown as {
    execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }>;
  };
  return (params: Record<string, unknown>) => def.execute("t", params).then((r) => r.content.map((c) => c.text).join("\n"));
}

describe('search-tools scope="claw" — grouped by connection', () => {
  const result: DeploymentSearchResult = {
    matches: [
      match({ name: "google-drive-search", integration: "google", connection: "connected", connector: { type: "google", name: "Google" } }),
      match({ name: "github-repo-snapshot", integration: "github", connection: "not_connected", connector: { type: "github", name: "GitHub" } }),
      match({ slug: "create-app", name: "Create app", integration: "react-artifact", connection: "builtin" }),
    ],
    connectors: [{ type: "grafana", name: "Grafana", description: "metrics and alerting", connection: "not_connected" }],
  };

  it("separates connected tools from ones the user must connect first", async () => {
    const out = await searchTool({ result, runToolNames: ["create-app"] })({ scope: "claw", query: "anything" });
    const connectedAt = out.indexOf("## Connected");
    const notConnectedAt = out.indexOf("## Available but NOT connected");
    expect(connectedAt).toBeGreaterThan(-1);
    expect(notConnectedAt).toBeGreaterThan(connectedAt);
    expect(out.slice(connectedAt, notConnectedAt)).toContain("google-drive-search");
    expect(out.slice(notConnectedAt)).toContain("github-repo-snapshot");
    // A connector with nothing indexed is still offered.
    expect(out.slice(notConnectedAt)).toContain("Grafana [grafana]");
  });

  it("tags what is already in this run — MCP by server, built-ins by slug", async () => {
    const out = await searchTool({ result, runToolNames: ["create-app"] })({ scope: "claw" });
    expect(out).toMatch(/google-drive-search \[google, read\] \(in this run\)/);
    expect(out).toMatch(/Create app \[react-artifact, read\] \(in this run\)/);
  });

  it("points the not-connected group at suggest-connectors with the exact server types", async () => {
    const out = await searchTool({ result })({ scope: "claw" });
    expect(out).toContain('call suggest-connectors({ serverTypes: ["github", "grafana"] })');
  });

  it("falls back to plain advice when suggest-connectors is not registered", async () => {
    const out = await searchTool({ result, suggestConnectorsAvailable: false })({ scope: "claw" });
    expect(out).not.toContain("suggest-connectors(");
    expect(out).toContain("tell the user to connect github, grafana");
  });

  it("keeps working against an older claw-auth that sends no connection data", async () => {
    const legacy: DeploymentSearchResult = { matches: [match({ name: "legacy-tool" })], connectors: [] };
    const out = await searchTool({ result: legacy })({ scope: "claw" });
    expect(out).toContain("legacy-tool");
    expect(out).not.toContain("## Connected");
  });
});

describe("configured-but-unresolved servers", () => {
  it("answers scope=mcp for a selected server that did not resolve", async () => {
    const out = await searchTool({ unresolvedConfigured: [grafanaUnresolved] })({ scope: "mcp", mcp: "grafana" });
    expect(out).toContain("Selected in this agent's config but NOT in this run");
    expect(out).toContain("grafana (Grafana) — not connected for this user");
    expect(out).toContain('suggest-connectors({ serverTypes: ["grafana"] })');
  });

  it("lists them under the connected servers", async () => {
    const out = await searchTool({ unresolvedConfigured: [grafanaUnresolved] })({ scope: "mcp" });
    expect(out).toContain("1 connected MCP server(s)");
    expect(out).toContain("grafana (Grafana) — not connected");
  });

  it("only advises connecting servers that are actually not connected", () => {
    const text = renderUnresolvedConfigured(
      [{ ...grafanaUnresolved, serverType: "kibana", serverName: "Kibana", reason: "unavailable", tools: ["search"] }],
      true,
    );
    expect(text).toContain("has credentials but failed to load this run: search");
    expect(text).not.toContain("suggest-connectors(");
  });
});

describe('search-tools scope="agent" — integrations the query names but the run lacks', () => {
  const deployment: DeploymentSearchResult = {
    matches: [
      match({ name: "github-list-stargazers", integration: "github", connection: "not_connected", connector: { type: "github", name: "GitHub" } }),
      match({ name: "google-drive-search", integration: "google", connection: "connected", connector: { type: "google", name: "Google" } }),
      match({ name: "asana-list-tasks", integration: "asana", connection: "not_connected", connector: { type: "asana", name: "Asana" } }),
    ],
    connectors: [{ type: "grafana", name: "Grafana", description: "metrics", connection: "not_connected" }],
  };

  it("adds a not-connected section for a named integration, with the connect call", async () => {
    const out = await searchTool({ result: deployment })({ query: "who starred the github repo" });
    expect(out).toContain("## Named in your query but NOT connected for this user (1)");
    expect(out).toContain("github-list-stargazers");
    expect(out).toContain('suggest-connectors({ serverTypes: ["github"] })');
    // Not named in the query → not advertised, even though it is not connected.
    expect(out).not.toContain("asana-list-tasks");
  });

  it("offers a never-connected connector the query names", async () => {
    const out = await searchTool({ result: deployment })({ query: "grafana alert status" });
    expect(out).toContain("Grafana [grafana] — connector");
  });

  it("stays quiet when the named integration is already in this run", async () => {
    const out = await searchTool({ result: deployment, mcpServers: [{ serverType: "github", serverName: "GitHub", tools: 4 }] })({
      query: "github stars",
    });
    expect(out).not.toContain("NOT connected");
  });

  it("stays quiet when the deployment lookup fails", async () => {
    const tools = buildFastModeMetaTools({
      catalog: [],
      controller: {},
      searchDeployment: async () => {
        throw new Error("down");
      },
    });
    const def = tools.find((t) => t.name === "search-tools")! as unknown as {
      execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }>;
    };
    const out = (await def.execute("t", { query: "github stars" })).content[0]!.text;
    expect(out).not.toContain("NOT connected");
  });
});
