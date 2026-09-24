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

describe("subagent read tools in the catalog", () => {
  it("adds nothing from subagents when the switch is off, as before", () => {
    const items = buildToolCatalog({ groups: [spaces, github] });
    expect(names(items)).toEqual([]);
  });

  it("catalogues only the read tools of the agent's own subagent servers", () => {
    const items = buildToolCatalog({ groups: [spaces, github], includeSubagentReadTools: true });
    expect(names(items)).toEqual([
      "GitHub__get_file_content",
      "GitHub__search_code",
      "Xyne_Spaces__spaces-messages",
      "Xyne_Spaces__spaces-search",
      "Xyne_Spaces__spaces-users",
    ]);
  });

  it("never catalogues a subagent's write tools, declared or not", () => {
    const items = buildToolCatalog({ groups: [spaces, github], includeSubagentReadTools: true });
    const all = names(items);
    for (const w of ["Xyne_Spaces__spaces-send-message", "Xyne_Spaces__spaces-delete-message", "GitHub__create_pull_request", "GitHub__push_files", "GitHub__create_issue", "GitHub__fork_repository"]) {
      expect(all).not.toContain(w);
    }
  });

  it("labels each tool with its subagent so search-tools and the index group them", () => {
    const items = buildToolCatalog({ groups: [spaces, github], includeSubagentReadTools: true });
    const sources = new Set(items.map((i) => i.entry.source));
    expect(sources).toEqual(new Set(["subagent:spaces", "subagent:github"]));
  });

  it("leaves servers no subagent wraps alone", () => {
    const items = buildToolCatalog({ groups: [spaces, unwrapped], includeSubagentReadTools: true });
    expect(names(items)).not.toContain("Heisenberg_Pipeline__heisenberg_get_status");
  });

  it("only sees servers the session was actually given", () => {
    const items = buildToolCatalog({ groups: [github], includeSubagentReadTools: true });
    expect(names(items).every((n) => n.startsWith("GitHub__"))).toBe(true);
  });

  it("defers to fast mode, which already catalogues subagent tools including writes", () => {
    const fast = buildToolCatalog({ groups: [spaces], includeSubagentTools: true });
    const both = buildToolCatalog({ groups: [spaces], includeSubagentTools: true, includeSubagentReadTools: true });
    expect(names(both)).toEqual(names(fast));
  });

  it("is registered and off by default", () => {
    expect(OPTIMIZATIONS.subagent_read_tools.defaultOn).toBe(false);
  });

  it("tells the model in the index to call a subagent's tools itself first", () => {
    const catalog = buildToolCatalog({ groups: [spaces, github], includeSubagentReadTools: true }).map((i) => i.entry);
    const out = renderToolCatalogForPrompt(catalog, { fullIndex: true, preferDirect: true });
    expect(out).toContain("The github, spaces catalogs hold the same read tools your subagents of that name use.");
    expect(out).toContain("Call them yourself first");
  });

  it("adds no direct-first line when the switch is off or delegation is disabled", () => {
    const catalog = buildToolCatalog({ groups: [spaces], includeSubagentReadTools: true }).map((i) => i.entry);
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
  });

  it("is unchanged when the switch is off", async () => {
    const d = await description(false);
    expect(d.startsWith("[Subagent — nested LLM run, expensive] Search and read Xyne Spaces data")).toBe(true);
    expect(d).not.toContain("call them yourself first");
  });
});
