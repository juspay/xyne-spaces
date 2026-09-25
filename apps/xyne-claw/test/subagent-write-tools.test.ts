import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSubagentTools, type CustomSubagentSpec } from "../src/subagent-tools.js";
import type { McpToolGroup } from "../src/mcp.js";

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text" as const, text: `${name} result` }], details: {} };
    },
  } as ToolDefinition;
}

describe("subagent write tools", () => {
  const spacesGroup: McpToolGroup = {
    serverType: "xyne-spaces",
    serverName: "Xyne_Spaces",
    tools: [tool("Xyne_Spaces__spaces-search"), tool("Xyne_Spaces__spaces-create-ticket")],
    writeTools: ["spaces-create-ticket"],
  };

  it("keeps built-in connector write tools on the subagent and no longer force-unwraps them to the parent", () => {
    const { subagentTools, directTools } = buildSubagentTools([spacesGroup]);

    expect(subagentTools.map((t) => t.name)).toEqual(["spaces"]);
    // Writes stay inside the subagent palette, where the MCP execute path
    // queues a signed pendingAction instead of executing. They used to be
    // pushed to the parent as well for parent-driven approval prompts, which
    // made every write permanently prompt-resident — the catalog skips writes,
    // and anything uncatalogued can never go dormant.
    expect(directTools.map((t) => t.name)).toEqual([]);
  });

  it("restores the parent-level push when XYNE_UNWRAP_WRITE_TOOLS=1", () => {
    process.env["XYNE_UNWRAP_WRITE_TOOLS"] = "1";
    try {
      const { directTools } = buildSubagentTools([spacesGroup]);
      expect(directTools.map((t) => t.name)).toEqual(["Xyne_Spaces__spaces-create-ticket"]);
    } finally {
      delete process.env["XYNE_UNWRAP_WRITE_TOOLS"];
    }
  });

  it("allows custom subagents to resolve selected write tools", () => {
    const spec: CustomSubagentSpec = {
      name: "ticket-writer",
      description: "creates tickets",
      progressLabels: [],
      systemPrompt: "Create the requested ticket.",
      paramName: "question",
      paramDescription: "Ticket request",
      tools: { direct: ["spaces-create-ticket"] },
      skills: [],
    };

    const { subagentTools } = buildSubagentTools([spacesGroup], undefined, undefined, undefined, undefined, undefined, undefined, [spec]);

    expect(subagentTools.map((t) => t.name)).toEqual(["spaces", "ticket-writer"]);
  });
});
