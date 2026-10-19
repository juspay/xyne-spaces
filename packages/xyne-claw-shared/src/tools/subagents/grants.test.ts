import { describe, expect, it } from "vitest";
import { findUnusedGrants, grantMatchesToolName, type AgentToolsConfig } from "./definitions.js";

describe("grantMatchesToolName", () => {
  it.each([
    ["web-search", "web-search", true],
    ["search_repositories", "GitHub__search_repositories", true],
    ["Knowledge_Base__kb-search", "kb-search", true],
    ["Spaces_Create_Ticket", "spaces-create-ticket", true],
    ["web-search", "kb-search", false],
    ["spaces-create-ticket", "spaces-close-ticket", false],
    ["", "web-search", false],
    ["web-search", "", false],
  ])("(%s, %s) -> %s", (grant, tool, expected) => {
    expect(grantMatchesToolName(grant, tool)).toBe(expected);
  });
});

describe("findUnusedGrants", () => {
  const cfg: AgentToolsConfig = {
    subagents: ["spaces", "grafana"],
    direct: ["spaces-create-ticket"],
    custom: ["web-search", "deep-research"],
    gateway: ["jira-gateway"],
  };

  it("reports only grants that no observed tool exercised", () => {
    const unused = findUnusedGrants(cfg, ["spaces__spaces-search", "spaces-create-ticket", "web-search", "jira-gateway__create_issue"]);
    expect(unused).toEqual([
      { kind: "subagents", grant: "grafana" },
      { kind: "custom", grant: "deep-research" },
    ]);
  });

  it("handles no config, no observations and duplicate observations", () => {
    expect(findUnusedGrants(undefined, ["web-search"])).toEqual([]);
    expect(findUnusedGrants({ custom: ["web-search"] }, [])).toEqual([{ kind: "custom", grant: "web-search" }]);
    expect(findUnusedGrants({ custom: ["web-search"] }, ["web-search", "web-search"])).toEqual([]);
  });
});
