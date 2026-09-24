import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildToolCatalog } from "../src/tool-catalog.js";
import type { McpToolGroup } from "../src/mcp.js";

function tool(name: string, extra: Record<string, unknown> = {}): ToolDefinition {
  return { name, description: `${name} desc`, parameters: { type: "object", properties: {} }, ...extra } as unknown as ToolDefinition;
}

const heisenberg: McpToolGroup = {
  serverType: "heisenberg",
  serverName: "Heisenberg Pipeline",
  tools: [
    tool("Heisenberg_Pipeline__heisenberg_get_status"),
    tool("Heisenberg_Pipeline__heisenberg_start_pipeline"),
    tool("Heisenberg_Pipeline__heisenberg_index_logs"),
  ],
  writeTools: ["heisenberg_start_pipeline", "heisenberg_index_logs"],
};

const customTools = [
  tool("list_agents", { source: "custom:agent-introspect" }),
  tool("create-agent", { source: "custom:agent-tools", isWriteTool: true }),
  tool("publish-review-room", { source: "custom:pr-review-room", isWriteTool: true }),
];

const names = (items: ReturnType<typeof buildToolCatalog>): string[] => items.map((i) => i.entry.name).sort();

describe("lean palette cataloguing", () => {
  it("keeps write tools out of the catalog by default, so they stay always-active as before", () => {
    const items = buildToolCatalog({ groups: [heisenberg], customTools, catalogUnwrapped: true });
    expect(names(items)).toEqual(["Heisenberg_Pipeline__heisenberg_get_status", "list_agents"]);
  });

  it("catalogues palette-reachable write tools when lean, so nothing ungranted sits in the prompt", () => {
    const items = buildToolCatalog({ groups: [heisenberg], customTools, catalogUnwrapped: true, catalogUnwrappedWrites: true });
    expect(names(items)).toEqual([
      "Heisenberg_Pipeline__heisenberg_get_status",
      "Heisenberg_Pipeline__heisenberg_index_logs",
      "Heisenberg_Pipeline__heisenberg_start_pipeline",
      "create-agent",
      "list_agents",
      "publish-review-room",
    ]);
  });

  it("does nothing without the open palette, whatever the lean flag says", () => {
    expect(buildToolCatalog({ groups: [heisenberg], customTools, catalogUnwrappedWrites: true })).toEqual([]);
  });
});
