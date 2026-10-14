import { describe, expect, it } from "vitest";
import { isWriteToolUnderPolicy } from "../connector-definitions.js";
import { ATLASSIAN_READ_TOOLS, atlassianRemoteAdapter } from "./atlassian-remote.js";

const policy = atlassianRemoteAdapter.writePolicy;

describe("atlassian-remote write policy (v2 tool names)", () => {
  it("targets the v2 endpoint", () => {
    expect(atlassianRemoteAdapter.buildHttpUrl({ accessToken: "t" }).url).toBe("https://mcp.atlassian.com/v2/mcp");
  });

  it.each(["getJiraIssue", "searchJiraIssuesUsingJql", "searchConfluence", "getConfluenceContent", "executeRead", "listJiraProjects"])(
    "lets the v2 read tool %s run without approval",
    (tool) => {
      expect(isWriteToolUnderPolicy(policy, tool)).toBe(false);
    },
  );

  it.each([
    "createJiraIssue",
    "editJiraIssue",
    "transitionJiraIssue",
    "addOrEditJiraIssueComment",
    "createConfluenceContent",
    "updateConfluenceContent",
    "deleteJiraIssue",
    "executeWrite",
    "executeDestructive",
    "someToolAtlassianAddsLater",
  ])("requires approval for %s", (tool) => {
    expect(isWriteToolUnderPolicy(policy, tool)).toBe(true);
  });

  it("no longer lists the retired v1 tool names", () => {
    const reads: readonly string[] = ATLASSIAN_READ_TOOLS;
    for (const v1Only of ["getVisibleJiraProjects", "getTransitionsForJiraIssue", "searchConfluenceUsingCql", "getConfluencePage"]) {
      expect(reads).not.toContain(v1Only);
    }
  });
});
