import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildFastModeMetaTools, buildToolCatalog, renderToolCatalogForPrompt } from "../src/tool-catalog.js";
import { currentSubagentMcpId } from "../src/subagent-mcp-context.js";
import type { McpToolGroup } from "../src/mcp.js";
import type { CustomSubagentSpec } from "../src/subagent-tools.js";

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} desc`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: `ran in ${currentSubagentMcpId() ?? "parent"}` }], details: {} }),
  } as unknown as ToolDefinition;
}

const grafana: McpToolGroup = {
  serverType: "grafana",
  serverName: "Grafana",
  tools: [tool("Grafana__query_loki_logs"), tool("Grafana__query_postgres"), tool("Grafana__list_datasources")],
  writeTools: [],
};

const region = (name: string, id?: string): CustomSubagentSpec =>
  ({
    ...(id ? { id } : {}),
    name,
    description: `${name} grafana`,
    progressLabels: [],
    systemPrompt: "",
    paramName: "question",
    paramDescription: "",
    tools: { direct: ["query_loki_logs", "query_postgres", "list_datasources"] },
    skills: [],
  }) as CustomSubagentSpec;

const regions = [region("grafana-hyperswitch", "sa-us"), region("grafana-hyperswitch-eu", "sa-eu"), region("grafana-hyperswitch-india", "sa-in")];

const catalogFor = (specs: CustomSubagentSpec[]) =>
  buildToolCatalog({ groups: [grafana], customSubagents: specs, includeSubagentTools: true });

describe("custom subagents that share one MCP server with different credentials", () => {
  it("gives each subagent its own loadable copy of the server's tools", () => {
    const names = catalogFor(regions).map((i) => i.entry.name);
    for (const r of ["grafana-hyperswitch", "grafana-hyperswitch-eu", "grafana-hyperswitch-india"]) {
      expect(names).toContain(`${r}__query_loki_logs`);
      expect(names).toContain(`${r}__query_postgres`);
    }
  });

  it("labels each copy with its subagent and the MCP server it came from", () => {
    const eu = catalogFor(regions).find((i) => i.entry.name === "grafana-hyperswitch-eu__query_postgres")!;
    expect(eu.entry.source).toBe("custom-subagent:grafana-hyperswitch-eu");
    expect(eu.entry.catalog).toBe("grafana-hyperswitch-eu");
    expect(eu.entry.mcpServer).toBe("grafana");
    expect(eu.entry.oneLineDescription).toContain("[grafana-hyperswitch-eu]");
  });

  it("runs a direct call with that subagent's identity, so the region's credentials are used", async () => {
    const items = catalogFor(regions);
    const run = async (name: string) => {
      const t = items.find((i) => i.entry.name === name)!.tool as unknown as { execute: (...a: unknown[]) => Promise<{ content: Array<{ text: string }> }> };
      return (await t.execute("call-1", {})).content[0]!.text;
    };
    expect(await run("grafana-hyperswitch-india__query_postgres")).toBe("ran in sa-in");
    expect(await run("grafana-hyperswitch-eu__query_loki_logs")).toBe("ran in sa-eu");
    expect(await run("grafana-hyperswitch__list_datasources")).toBe("ran in sa-us");
  });

  it("is found by search-tools scoped to the MCP server", async () => {
    const catalog = catalogFor(regions).map((i) => i.entry);
    const meta = buildFastModeMetaTools({
      catalog,
      controller: { getActiveToolSet: () => [], loadTools: async (n: string[]) => ({ loaded: n, alreadyLoaded: [], unknown: [], activeToolSet: n, maxActiveTools: 128 }) },
    });
    const search = meta.find((t) => t.name === "search-tools")! as unknown as { execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }> };
    const summary = (await search.execute("t", { scope: "mcp", mcp: "grafana" })).content.map((c) => c.text).join("\n");
    expect(summary).not.toContain("none of its");
    expect(summary).toMatch(/loadable tool\(s\)/);
    const hits = (await search.execute("t", { query: "postgres india" })).content.map((c) => c.text).join("\n");
    expect(hits).toContain("grafana-hyperswitch-india__query_postgres");
  });

  it("tells the model in the index to call them itself first", () => {
    const out = renderToolCatalogForPrompt(catalogFor(regions).map((i) => i.entry), { fullIndex: true, preferDirect: true });
    expect(out).toContain("grafana-hyperswitch");
    expect(out).toContain("Call them yourself first");
  });

  it("keeps the shared name when the subagent has no id to route credentials by", () => {
    const names = catalogFor([region("grafana-legacy")]).map((i) => i.entry.name);
    expect(names).toContain("Grafana__query_loki_logs");
    expect(names).not.toContain("grafana-legacy__query_loki_logs");
  });

  it("adds nothing when subagent tools are not being catalogued", () => {
    expect(buildToolCatalog({ groups: [grafana], customSubagents: regions })).toEqual([]);
  });
});
