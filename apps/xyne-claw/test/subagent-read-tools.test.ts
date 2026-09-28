import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildToolCatalog, renderToolCatalogForPrompt } from "../src/tool-catalog.js";
import { OPTIMIZATIONS, pinRunOptimizations } from "../src/optimizations.js";
import { buildSubagentTools } from "../src/subagent-tools.js";
import type { McpToolGroup } from "../src/mcp.js";

function tool(name: string): ToolDefinition {
  return { name, description: `${name} desc`, parameters: { type: "object", properties: {} } } as unknown as ToolDefinition;
}

const spaces: McpToolGroup = {
  serverType: "xyne-spaces",
  serverName: "Xyne Spaces",
  tools: [
    tool("Xyne_Spaces__spaces-messages"),
    tool("Xyne_Spaces__spaces-users"),
    tool("Xyne_Spaces__spaces-search"),
    tool("Xyne_Spaces__spaces-send-message"),
    tool("Xyne_Spaces__spaces-delete-message"),
  ],
  writeTools: ["spaces-send-message", "spaces-delete-message"],
};

const github: McpToolGroup = {
  serverType: "github",
  serverName: "GitHub",
  tools: [
    tool("GitHub__get_file_content"),
    tool("GitHub__search_code"),
    tool("GitHub__create_pull_request"),
    tool("GitHub__push_files"),
    tool("GitHub__create_issue"),
    tool("GitHub__fork_repository"),
  ],
  writeTools: ["create_pull_request"],
};

const unwrapped: McpToolGroup = {
  serverType: "heisenberg",
  serverName: "Heisenberg Pipeline",
  tools: [tool("Heisenberg_Pipeline__heisenberg_get_status")],
  writeTools: [],
};

const names = (items: ReturnType<typeof buildToolCatalog>): string[] => items.map((i) => i.entry.name).sort();

describe("subagent tools in the catalog", () => {
  const withSwitch = (groups: McpToolGroup[]) => buildToolCatalog({ groups, includeSubagentTools: true });

  it("adds nothing from subagents when the switch is off, as before", () => {
    expect(names(buildToolCatalog({ groups: [spaces, github] }))).toEqual([]);
  });

  it("catalogues every tool of the agent's own subagent servers, writes included", () => {
    expect(names(withSwitch([spaces, github]))).toEqual([
      "GitHub__create_issue",
      "GitHub__create_pull_request",
      "GitHub__fork_repository",
      "GitHub__get_file_content",
      "GitHub__push_files",
      "GitHub__search_code",
      "Xyne_Spaces__spaces-delete-message",
      "Xyne_Spaces__spaces-messages",
      "Xyne_Spaces__spaces-search",
      "Xyne_Spaces__spaces-send-message",
      "Xyne_Spaces__spaces-users",
    ]);
  });

  it("labels each tool with its subagent so search-tools and the index group them", () => {
    expect(new Set(withSwitch([spaces, github]).map((i) => i.entry.source))).toEqual(new Set(["subagent:spaces", "subagent:github"]));
  });

  it("leaves servers no subagent wraps alone", () => {
    expect(names(withSwitch([spaces, unwrapped]))).not.toContain("Heisenberg_Pipeline__heisenberg_get_status");
  });

  it("only sees servers the session was actually given", () => {
    expect(names(withSwitch([github])).every((n) => n.startsWith("GitHub__"))).toBe(true);
  });

  it("is registered and off by default", () => {
    expect(OPTIMIZATIONS.subagent_read_tools.defaultOn).toBe(false);
  });

  it("tells the model in the index to call a subagent's tools, writes included, itself first", () => {
    const catalog = withSwitch([spaces, github]).map((i) => i.entry);
    const out = renderToolCatalogForPrompt(catalog, { fullIndex: true, preferDirect: true });
    expect(out).toContain("The github, spaces catalogs hold the same tools your subagents of that name use, writes included.");
    expect(out).toContain("Call them yourself first");
    expect(out).not.toContain("delegate only for a write");
  });

  it("adds no direct-first line when the switch is off or delegation is disabled", () => {
    const catalog = withSwitch([spaces]).map((i) => i.entry);
    expect(renderToolCatalogForPrompt(catalog, { fullIndex: true })).not.toContain("Call them yourself first");
    expect(renderToolCatalogForPrompt(catalog, { fullIndex: true, preferDirect: true, subagentDelegationDisabled: true })).not.toContain("Call them yourself first");
  });
});

describe("subagent tool description", () => {
  const description = async (on: boolean): Promise<string> => {
    pinRunOptimizations({ subagent_read_tools: on });
    const { subagentTools } = buildSubagentTools([spaces]);
    return String(subagentTools.find((t) => t.name === "spaces")?.description ?? "");
  };

  it("says to use the direct tools first when the switch is on", async () => {
    const d = await description(true);
    expect(d).toContain("[Subagent — nested LLM run, expensive] Slow: this runs a whole nested model.");
    expect(d).toContain("call them yourself first");
    expect(d).toContain("writes included");
    expect(d).not.toContain("only for a write");
  });

  it("is unchanged when the switch is off", async () => {
    const d = await description(false);
    expect(d.startsWith("[Subagent — nested LLM run, expensive] Search and read Xyne Spaces data")).toBe(true);
    expect(d).not.toContain("call them yourself first");
  });
});
