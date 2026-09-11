/**
 * Regression for the subagent-only MCP credentials bug: claw-auth now lists a
 * server group whose credentials live on a subagent definition (marked with
 * `sourceSubagent`). Such a group must reach the subagent's palette and must
 * NOT leak into the parent agent's direct tools or its fast-mode catalog.
 *
 * Also covers the empty-catalog meta tools: load-tools used to answer
 * "Error: tool loader is not initialized" because agent.ts only wires the
 * runtime loader when the catalog has entries.
 */
import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildToolCatalog, buildFastModeDirectTools, buildFastModeMetaTools } from "../src/tool-catalog.js";
import { buildSubagentTools } from "../src/subagent-tools.js";
import type { McpToolGroup } from "../src/mcp.js";

function tool(name: string): ToolDefinition {
  return { name, description: `${name} desc`, parameters: { type: "object", properties: {} } } as unknown as ToolDefinition;
}

const subagentSourcedGroup: McpToolGroup = {
  serverType: "juspay-dashboard-stream",
  serverName: "Juspay Dashboard Stream",
  tools: [tool("Juspay_Dashboard_Stream__query"), tool("Juspay_Dashboard_Stream__write_row")],
  writeTools: ["write_row"],
  sourceSubagent: { id: "sub-pl", name: "paymentlinks" },
};

const customSubagents = [
  {
    name: "paymentlinks",
    description: "payment links",
    progressLabels: ["working"],
    systemPrompt: "do the thing",
    paramName: "task",
    paramDescription: "task",
    tools: { direct: ["query"] },
    skills: [],
  },
];

async function runTool(def: ToolDefinition, params: unknown): Promise<string> {
  const result = await (def as unknown as {
    execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
  }).execute("call-1", params);
  return result.content.map((c) => c.text).join("\n");
}

describe("subagent-sourced MCP groups", () => {
  it("keeps the group out of the parent's direct tools but still builds the subagent", () => {
    const { subagentTools, directTools } = buildSubagentTools(
      [subagentSourcedGroup],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      customSubagents as never,
    );

    expect(directTools.map((t) => t.name)).not.toContain("Juspay_Dashboard_Stream__query");
    expect(directTools.map((t) => t.name)).not.toContain("Juspay_Dashboard_Stream__write_row");
    expect(subagentTools.map((t) => t.name)).toContain("paymentlinks");
  });

  it("still leaks nothing into fast-mode direct tools", () => {
    const { directTools } = buildFastModeDirectTools({ groups: [subagentSourcedGroup] });
    expect(directTools).toEqual([]);
  });

  it("catalogues the tools under the custom subagent, not as parent tools", () => {
    const items = buildToolCatalog({
      groups: [subagentSourcedGroup],
      customSubagents: customSubagents as never,
      includeSubagentTools: true,
    });
    expect(items.map((i) => i.entry.source)).toEqual(["custom-subagent:paymentlinks"]);
    expect(items[0]!.entry.name).toBe("Juspay_Dashboard_Stream__query");
  });

  it("passes a group without the marker through to direct tools as before", () => {
    const { sourceSubagent: _omit, ...plain } = subagentSourcedGroup;
    const { directTools } = buildFastModeDirectTools({ groups: [plain as McpToolGroup] });
    expect(directTools.map((t) => t.name)).toContain("Juspay_Dashboard_Stream__query");
  });
});

describe("empty tool catalog meta tools", () => {
  it("answers load-tools with an actionable message instead of a loader error", async () => {
    const metaTools = buildFastModeMetaTools({
      catalog: [],
      controller: {},
      emptyCatalogNote: "Configured subagents: paymentlinks, payouts — they resolved to 0 tools.",
    });
    const loadTools = metaTools.find((t) => t.name === "load-tools")!;

    const text = await runTool(loadTools, { names: ["anything"] });

    expect(text).not.toContain("tool loader is not initialized");
    expect(text).toContain("No loadable tools are configured for this agent.");
    expect(text).toContain("paymentlinks, payouts");
  });

  it("mentions the same note from list-tools", async () => {
    const metaTools = buildFastModeMetaTools({
      catalog: [],
      controller: {},
      emptyCatalogNote: "Configured subagents: paymentlinks — they resolved to 0 tools.",
    });
    const listTools = metaTools.find((t) => t.name === "list-tools")!;

    const text = await runTool(listTools, {});

    expect(text).toContain("The tool catalog is empty.");
    expect(text).toContain("paymentlinks");
  });

  it("keeps the loader path for a non-empty catalog", async () => {
    let requested: string[] = [];
    const metaTools = buildFastModeMetaTools({
      catalog: [{ name: "a-tool", oneLineDescription: "does a", source: "subagent:x", catalog: "x" }],
      controller: {
        loadTools: async (names: string[]) => {
          requested = names;
          return { loaded: names, alreadyLoaded: [], unknown: [], activeToolSet: names, maxActiveTools: 10 };
        },
      },
    });
    const loadTools = metaTools.find((t) => t.name === "load-tools")!;

    const text = await runTool(loadTools, { names: ["a-tool"] });

    expect(requested).toEqual(["a-tool"]);
    expect(text).toContain("Loaded: a-tool");
  });
});
