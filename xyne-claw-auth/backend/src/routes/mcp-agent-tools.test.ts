import { describe, expect, it } from "vitest";
import type { AgentToolsConfig } from "xyne-claw-shared";
import type { McpServerTools } from "../mcp/types.js";
import {
  gatewayCatalogSource,
  gatewayToolSelectionKey,
  parseGatewayCatalogSource,
} from "../mcpgateway/key-format.js";
import {
  buildSubagentToolRefs,
  filterMcpServerToolsForAgentConfig,
  isMcpToolAllowedByAgentConfig,
  shouldBypassMcpToolAgentFilter,
  subagentReferencingTool,
} from "./mcp-agent-tools.js";

function parseGatewayServerType(serverType: string): { serviceName: string; backendId?: string } | null {
  const parsed = parseGatewayCatalogSource(serverType);
  if (parsed) return { serviceName: parsed.serviceName, backendId: parsed.backendId };
  if (!serverType.startsWith("gateway:")) return null;
  const serviceName = serverType.slice("gateway:".length).trim();
  return serviceName && !serviceName.includes(":") ? { serviceName } : null;
}

function allowed(
  config: AgentToolsConfig | undefined,
  serverType: string,
  serverName: string,
  tool: string | { name: string; selectionKey?: string },
): boolean {
  return isMcpToolAllowedByAgentConfig(config, serverType, serverName, tool, parseGatewayServerType);
}

function serverTools(serverType: string, serverName: string, toolNames: string[]): McpServerTools {
  return {
    serverType,
    serverName,
    tools: toolNames.map((name) => ({ name, description: "", inputSchema: {} })),
    writeTools: [],
  };
}

describe("MCP agent tool allow-set matcher", () => {
  it("allows a persisted subagent name by expanding to its serverType", () => {
    expect(allowed({ subagents: ["spaces"] }, "xyne-spaces", "Xyne Spaces", "spaces-search")).toBe(true);
  });

  it("allows a persisted subagent serverType entry directly", () => {
    expect(allowed({ subagents: ["xyne-spaces"] }, "xyne-spaces", "Xyne Spaces", "spaces-search")).toBe(true);
  });

  it("allows a persisted raw direct tool name", () => {
    expect(allowed({ direct: ["spaces-create-ticket"] }, "xyne-spaces", "Xyne Spaces", "spaces-create-ticket")).toBe(true);
  });

  it("allows a persisted serverType__tool slug without allowing the same tool on another server", () => {
    const config = { direct: ["github__search"] };
    expect(allowed(config, "github", "GitHub", "search")).toBe(true);
    expect(allowed(config, "slack", "Slack", "search")).toBe(false);
  });

  it("allows a persisted gateway tool selection key only for that gateway tool", () => {
    const key = gatewayToolSelectionKey("jira", "primary", "search");
    const config = { direct: [key] };
    expect(allowed(config, gatewayCatalogSource("jira", "primary"), "jira/primary", "search")).toBe(true);
    expect(allowed(config, "github", "GitHub", "search")).toBe(false);
  });

  it("allows a persisted gateway catalog source for every tool on that backend", () => {
    const source = gatewayCatalogSource("jira", "primary");
    expect(allowed({ gateway: [source] }, source, "jira/primary", "create_issue")).toBe(true);
  });

  it("allows a persisted gateway service name across that service", () => {
    expect(allowed({ gateway: ["jira"] }, gatewayCatalogSource("jira", "primary"), "jira/primary", "create_issue")).toBe(true);
  });

  it("allows persisted custom/System tool slugs through selectionKey", () => {
    expect(allowed({ custom: ["webfetch"] }, "claw-builtin", "Built-in", { name: "webfetch", selectionKey: "webfetch" })).toBe(true);
  });

  it("matches normalized case and underscore variants", () => {
    expect(allowed({ direct: ["GitHub__Search_Code"] }, "github", "GitHub", "search-code")).toBe(true);
  });

  it("keeps listing and call-gate verdicts consistent for the same serverName-based selection", () => {
    const config = { direct: ["Friendly GitHub__search_code"] };
    const listed = filterMcpServerToolsForAgentConfig(
      serverTools("github", "Friendly GitHub", ["search_code", "create_issue"]),
      config,
      parseGatewayServerType,
    );
    expect(listed?.tools.map((tool) => tool.name)).toEqual(["search_code"]);
    expect(allowed(config, "github", "Friendly GitHub", "search_code")).toBe(true);
  });

  it("exempts knowledge-base from strict agent tool filtering", () => {
    const kb = serverTools("knowledge-base", "Knowledge Base", ["kb-search"]);
    expect(shouldBypassMcpToolAgentFilter(kb.serverType)).toBe(true);
    expect(filterMcpServerToolsForAgentConfig(kb, { direct: ["unrelated"] }, parseGatewayServerType)).toBe(kb);
  });

  it("does not filter when strict mode is off and no config is supplied to the matcher", () => {
    const all = serverTools("github", "GitHub", ["search", "create_issue"]);
    expect(filterMcpServerToolsForAgentConfig(all, undefined, parseGatewayServerType)).toBe(all);
  });

  it("allows calls when there is no agent tools config", () => {
    expect(allowed(undefined, "github", "GitHub", "unlisted_tool")).toBe(true);
  });
});

describe("custom subagent tool references surviving enforcement", () => {
  // Mirrors prod: the subagent NAME (grafana-hyperswitch-india) differs from
  // the server type/name (grafana/Grafana), so the name-as-server allow key
  // does not match and only the per-tool references keep tools alive.
  const grafanaServer = () =>
    serverTools("grafana", "Grafana", ["query_loki_logs", "query_prometheus", "delete_dashboard"]);

  const grafanaSubagentRefs = () =>
    buildSubagentToolRefs([
      { name: "grafana-hyperswitch-india", tools: { direct: ["query_loki_logs", "query_prometheus"] } },
    ]);

  it("keeps subagent-referenced tools on a server the agent config does not select", () => {
    const config: AgentToolsConfig = { subagents: ["grafana-hyperswitch-india"], direct: [] };
    const retained = new Set<string>();
    const result = filterMcpServerToolsForAgentConfig(
      grafanaServer(),
      config,
      parseGatewayServerType,
      grafanaSubagentRefs(),
      retained,
    );
    expect(result?.tools.map((tool) => tool.name)).toEqual(["query_loki_logs", "query_prometheus"]);
    expect(retained).toEqual(new Set(["grafana-hyperswitch-india"]));
  });

  it("still drops servers no subagent references", () => {
    const config: AgentToolsConfig = { subagents: ["grafana-hyperswitch-india"], direct: [] };
    const result = filterMcpServerToolsForAgentConfig(
      serverTools("figma", "Figma", ["get_file", "get_comments"]),
      config,
      parseGatewayServerType,
      grafanaSubagentRefs(),
    );
    expect(result).toBeNull();
  });

  it("matches prefixed tool names and normalized variants like the runtime resolver", () => {
    const refs = buildSubagentToolRefs([
      { name: "grafana", tools: { direct: ["Grafana__query_loki_logs"] } },
    ]);
    expect(subagentReferencingTool(refs, { name: "query_loki_logs" })).toBe("grafana");
    expect(subagentReferencingTool(refs, { name: "Grafana__query_loki_logs" })).toBe("grafana");
    expect(subagentReferencingTool(refs, { name: "query-loki-logs" })).toBe("grafana");
    expect(subagentReferencingTool(refs, { name: "unrelated_tool" })).toBeNull();
  });

  it("matches custom-tool slugs via selectionKey", () => {
    const refs = buildSubagentToolRefs([{ name: "mixpanel", tools: { custom: ["mixpanel-run-query"] } }]);
    expect(subagentReferencingTool(refs, { name: "Mixpanel Run Query", selectionKey: "mixpanel-run-query" })).toBe("mixpanel");
  });

  it("agent with no subagents behaves exactly as before", () => {
    const config: AgentToolsConfig = { direct: ["search_code"] };
    const withRefs = filterMcpServerToolsForAgentConfig(
      serverTools("github", "GitHub", ["search_code", "create_issue"]),
      config,
      parseGatewayServerType,
      [],
    );
    const withoutRefs = filterMcpServerToolsForAgentConfig(
      serverTools("github", "GitHub", ["search_code", "create_issue"]),
      config,
      parseGatewayServerType,
    );
    expect(withRefs?.tools.map((t) => t.name)).toEqual(["search_code"]);
    expect(withoutRefs?.tools.map((t) => t.name)).toEqual(["search_code"]);
  });

  it("ignores subagent definitions with empty or invalid tools configs", () => {
    expect(buildSubagentToolRefs([
      { name: "empty", tools: {} },
      { name: "null-tools", tools: null },
      { name: "junk", tools: "not-an-object" },
    ])).toEqual([]);
  });
});
