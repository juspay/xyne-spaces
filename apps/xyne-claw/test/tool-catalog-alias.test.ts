/**
 * tool-catalog-alias.test.ts — regression for the 2026-07-30 incident: prod's
 * active GitHub connector is registered as serverType "github-mcp-npx", which
 * had no SUBAGENT_DEFINITIONS entry, so buildToolCatalog dropped its whole
 * group and fast-mode agents saw ZERO GitHub tools (while normal mode passed
 * them through fine). Alias-aware lookup must route alias types into the fast
 * catalog under the canonical subagent source, and the write split must
 * behave identically for alias and canonical types.
 */
import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findSubagentDefinitionForServer } from "xyne-claw-shared";
import { buildToolCatalog, buildFastModeDirectTools, buildAlwaysActivePresentationToolNameSet } from "../src/tool-catalog.js";
import type { McpToolGroup } from "../src/mcp.js";

function tool(name: string, description = `${name} desc`): ToolDefinition {
  return { name, description, parameters: { type: "object", properties: {} } } as unknown as ToolDefinition;
}

const githubNpxGroup: McpToolGroup = {
  serverType: "github-mcp-npx",
  serverName: "GitHub",
  tools: [tool("GitHub__create_pull_request"), tool("GitHub__search_code"), tool("GitHub__merge_pull_request")],
  writeTools: ["merge_pull_request"],
};

describe("subagent definition alias lookup", () => {
  it("resolves github-mcp-npx to the github definition", () => {
    const def = findSubagentDefinitionForServer("github-mcp-npx");
    expect(def?.name).toBe("github");
    expect(findSubagentDefinitionForServer("github")?.name).toBe("github");
  });

  it("still returns undefined for genuinely unknown server types", () => {
    expect(findSubagentDefinitionForServer("no-such-server")).toBeUndefined();
  });
});

describe("fast-mode catalog with alias server type", () => {
  it("includes alias-group read tools under the canonical subagent source", () => {
    const items = buildToolCatalog({ groups: [githubNpxGroup], includeSubagentTools: true });
    const names = items.map((i) => i.entry.name);
    expect(names).toContain("GitHub__create_pull_request");
    expect(names).toContain("GitHub__search_code");
    // write tools never enter the lazy catalog — they go always-active direct
    expect(names).not.toContain("GitHub__merge_pull_request");
    for (const i of items) expect(i.entry.source).toBe("subagent:github");
  });

  it("splits alias-group write tools into always-active direct tools", () => {
    const { directTools } = buildFastModeDirectTools({ groups: [githubNpxGroup] });
    expect(directTools.map((t) => t.name)).toEqual(["GitHub__merge_pull_request"]);
  });
});


describe("explicit presentation tool selection", () => {
  const postChart = tool("post-chart", "Post chart") as ToolDefinition & { source: string; slug: string };
  postChart.source = "custom:code-artifacts";
  postChart.slug = "post-chart";

  it("keeps explicitly selected presentation tools out of the lazy-only path", () => {
    const explicit = buildAlwaysActivePresentationToolNameSet([postChart], ["post-chart"], false);
    expect([...explicit]).toEqual(["post-chart"]);

    const catalogItems = buildToolCatalog({ customTools: [postChart] });
    const fastAlwaysActiveToolNames = explicit;
    const lazyCatalogNames = catalogItems
      .filter((item) => !fastAlwaysActiveToolNames.has(item.entry.name))
      .map((item) => item.entry.name);

    expect(lazyCatalogNames).not.toContain("post-chart");
  });

  it("leaves non-thread presentation tools lazy when not explicitly selected", () => {
    const explicit = buildAlwaysActivePresentationToolNameSet([postChart], [], false);
    expect(explicit.size).toBe(0);

    const catalogItems = buildToolCatalog({ customTools: [postChart] });
    expect(catalogItems.map((item) => item.entry.name)).toContain("post-chart");
  });

  it("keeps default thread presentation tools always-active even without direct config", () => {
    const explicit = buildAlwaysActivePresentationToolNameSet([postChart], [], true);
    expect([...explicit]).toEqual(["post-chart"]);

    const catalogItems = buildToolCatalog({ customTools: [postChart] });
    const lazyCatalogNames = catalogItems
      .filter((item) => !explicit.has(item.entry.name))
      .map((item) => item.entry.name);

    expect(lazyCatalogNames).not.toContain("post-chart");
  });
});
