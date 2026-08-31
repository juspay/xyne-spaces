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

  it("keeps built-in connector write tools on the subagent while preserving parent-level approval compatibility", () => {
    const { subagentTools, directTools } = buildSubagentTools([spacesGroup]);

    expect(subagentTools.map((t) => t.name)).toEqual(["spaces"]);
    // Existing parent-driven prompts still see write tools directly. The same
    // ToolDefinition is also inside the spaces subagent palette, where its MCP
    // execute path queues a signed pendingAction instead of executing writes.
    expect(directTools.map((t) => t.name)).toEqual(["Xyne_Spaces__spaces-create-ticket"]);
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
