import { describe, expect, it } from "vitest";
import { looksReadOnly } from "../src/read-only-tools.js";

const githubServerTools = [
  "create_or_update_file", "search_repositories", "create_repository", "get_file_contents", "push_files", "create_issue",
  "create_pull_request", "fork_repository", "create_branch", "list_issues", "update_issue", "add_issue_comment", "search_code",
  "search_issues", "search_users", "get_issue", "get_pull_request", "list_pull_requests", "create_pull_request_review",
  "merge_pull_request", "get_pull_request_files", "get_pull_request_status", "update_pull_request_branch",
  "get_pull_request_comments", "get_pull_request_reviews",
];

describe("looksReadOnly", () => {
  it("keeps every GitHub write behind the subagent even though the connector declares only two", () => {
    const exposed = githubServerTools.filter((n) => looksReadOnly(`GitHub__${n}`));
    expect(exposed.sort()).toEqual([
      "get_file_contents", "get_issue", "get_pull_request", "get_pull_request_comments", "get_pull_request_files",
      "get_pull_request_reviews", "get_pull_request_status", "list_issues", "list_pull_requests", "search_code",
      "search_issues", "search_repositories", "search_users",
    ]);
  });

  it("catches side effects the shared write list misses", () => {
    for (const n of ["Xyne_Spaces__spaces-sdlc-mutate-artifact", "Xyne_Spaces__spaces-trigger-agent", "GitHub__fork_repository", "run_workflow", "deploy-service"]) {
      expect(looksReadOnly(n)).toBe(false);
    }
  });

  it("does not mistake noun-named reads for actions", () => {
    for (const n of ["Xyne_Spaces__spaces-calls", "Xyne_Spaces__spaces-emails", "Xyne_Spaces__spaces-messages", "Xyne_Spaces__spaces-channels", "Xyne_Spaces__spaces-whoami", "Xyne_Spaces__spaces-desk-metrics"]) {
      expect(looksReadOnly(n)).toBe(true);
    }
  });

  it("trusts a declared write over the name", () => {
    expect(looksReadOnly("Xyne_Spaces__spaces-messages", true)).toBe(false);
  });

  it("treats destructive names as never read-only", () => {
    expect(looksReadOnly("Xyne_Spaces__spaces-delete-message")).toBe(false);
  });
});
