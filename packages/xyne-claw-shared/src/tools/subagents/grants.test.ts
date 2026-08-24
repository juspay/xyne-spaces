/**
 * Locks the grant-to-tool-name conventions used by dead-tool analysis.
 *
 * These mirror the name matching in xyne-claw's `tool-resolution.ts`
 * `matchesDirectPick`, which is marked "do not simplify" because live agent
 * configs depend on every convention. A metrics reader that silently lost one
 * would report granted-and-used tools as dead, so each convention is asserted
 * individually rather than through a single happy-path case.
 */

import { describe, expect, it } from "vitest";
import { findUnusedGrants, grantMatchesToolName, type AgentToolsConfig } from "./definitions.js";

describe("grantMatchesToolName", () => {
  it("matches a bare name exactly", () => {
    expect(grantMatchesToolName("web-search", "web-search")).toBe(true);
  });

  it("matches when the runtime name is namespace-suffixed by the grant", () => {
    expect(grantMatchesToolName("search_repositories", "GitHub__search_repositories")).toBe(true);
  });

  it("matches a prefixed grant against a bare runtime name", () => {
    expect(grantMatchesToolName("Knowledge_Base__kb-search", "kb-search")).toBe(true);
  });

  it("normalises underscores and case", () => {
    expect(grantMatchesToolName("Spaces_Create_Ticket", "spaces-create-ticket")).toBe(true);
  });

  it("does not match unrelated tools", () => {
    expect(grantMatchesToolName("web-search", "kb-search")).toBe(false);
    expect(grantMatchesToolName("spaces-create-ticket", "spaces-close-ticket")).toBe(false);
  });

  it("treats empty input as no match rather than matching everything", () => {
    expect(grantMatchesToolName("", "web-search")).toBe(false);
    expect(grantMatchesToolName("web-search", "")).toBe(false);
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
    const unused = findUnusedGrants(cfg, [
      "spaces__spaces-search",
      "spaces-create-ticket",
      "web-search",
      "jira-gateway__create_issue",
    ]);
    expect(unused).toEqual([
      { kind: "subagents", grant: "grafana" },
      { kind: "custom", grant: "deep-research" },
    ]);
  });

  it("counts a subagent grant as exercised by any tool carrying its prefix", () => {
    expect(findUnusedGrants({ subagents: ["grafana"] }, ["grafana__query_range"])).toEqual([]);
  });

  it("returns nothing when there is no tools config, since every tool is then allowed", () => {
    expect(findUnusedGrants(undefined, ["web-search"])).toEqual([]);
  });

  it("reports every grant as unused when nothing was observed", () => {
    expect(findUnusedGrants({ custom: ["web-search"] }, [])).toEqual([
      { kind: "custom", grant: "web-search" },
    ]);
  });

  it("tolerates duplicate observations without double-counting", () => {
    expect(findUnusedGrants({ custom: ["web-search"] }, ["web-search", "web-search"])).toEqual([]);
  });
});
