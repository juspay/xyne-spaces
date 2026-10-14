import type { HttpMcpAdapter } from "../types.js";

/**
 * Read-only tools of GitHub's remote MCP server. Anything not listed is
 * treated as a write and needs approval; see LINEAR_READ_TOOLS for the
 * reasoning. Verify against a live tools/list when connected.
 */
export const GITHUB_READ_TOOLS = [
  "get_me",
  "get_file_contents",
  "search_code",
  "search_issues",
  "search_pull_requests",
  "search_repositories",
  "search_users",
  "search_orgs",
  "list_issues",
  "issue_read",
  "list_pull_requests",
  "pull_request_read",
  "list_commits",
  "get_commit",
  "list_branches",
  "list_tags",
  "get_tag",
  "list_releases",
  "get_latest_release",
  "get_release_by_tag",
  "list_issue_types",
  "list_notifications",
  "get_notification_details",
  "actions_get",
  "actions_list",
  "get_job_logs",
  "list_gists",
  "get_gist",
  "list_discussions",
  "get_discussion",
  "get_discussion_comments",
  "list_discussion_categories",
  "list_projects",
  "get_project",
  "list_project_fields",
  "get_project_field",
  "list_project_items",
  "get_project_item",
  "list_secret_scanning_alerts",
  "get_secret_scanning_alert",
  "list_code_scanning_alerts",
  "get_code_scanning_alert",
  "list_dependabot_alerts",
  "get_dependabot_alert",
  "list_global_security_advisories",
  "get_global_security_advisory",
  "list_repository_security_advisories",
  "list_org_repository_security_advisories",
  "get_team_members",
  "get_teams",
  "list_starred_repositories",
] as const;

/**
 * GitHub remote MCP — Streamable HTTP at https://api.githubcopilot.com/mcp/.
 * Auth: a GitHub user token as Bearer. Credentials come from
 * routes/github-remote-oauth.ts as { accessToken, refreshToken, expires }. The
 * stdio `github` connector (personal access token) is unaffected.
 */
export const githubRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "github-remote",
  credentialFields: [],
  healthCheck: { name: "__list_tools__", params: {} },
  writePolicy: { mode: "denylist", tools: GITHUB_READ_TOOLS },
  buildHttpUrl(credentials) {
    return {
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}` },
    };
  },
};
