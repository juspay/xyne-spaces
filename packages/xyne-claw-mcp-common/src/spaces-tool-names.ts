/**
 * Tool names of the Spaces MCP server (xyne-spaces-server), in its order.
 * xyne-spaces-tools-names.test.ts in the MCP service compares them with the tools.
 */
import { SERVER_ENV } from "./env.js";

/** Listed when DIRECT_VESPA_SEARCH is on, right after the first tool. */
export const SPACES_DIRECT_VESPA_TOOL_NAMES: readonly string[] = [
  "spaces-vespa-search",
  "spaces-corpus-scan",
  "spaces-evidence-pack",
];

/** Tools listed in every deployment. */
export const SPACES_BASE_TOOL_NAMES: readonly string[] = [
  "spaces-whoami",
  "spaces-my-items",
  "spaces-saved-views",
  "spaces-workflow-stats",
  "spaces-desk-metrics",
  "user-send-message",
  "spaces-meeting-insights",
  "spaces-tickets",
  "spaces-messages",
  "spaces-message-detail",
  "spaces-channels",
  "spaces-users",
  "spaces-user-activity-context",
  "spaces-activity",
  "spaces-projects",
  "spaces-project-team-members",
  "spaces-canvases",
  "spaces-calls",
  "spaces-boards",
  "spaces-board-fields",
  "spaces-emails",
  "spaces-send-ticket-email",
  "spaces-thread-attachments",
  "spaces-fetch-attachment",
  "spaces-upload-to-kb",
  "spaces-create-ticket",
  "spaces-create-bulk-tickets",
  "spaces-update-ticket",
  "spaces-update-bulk-tickets",
  "spaces-schedule-call",
  "spaces-start-call",
  "spaces-read-canvas",
  "spaces-edit-canvas",
  "spaces-trigger-agent",
  "spaces-create-canvas",
  "spaces-sdlc-list-artifacts",
  "spaces-sdlc-read-artifact",
  "spaces-sdlc-list-repositories",
  "spaces-sdlc-list-tracks",
  "spaces-sdlc-create-track",
  "spaces-sdlc-create-track-folder",
  "spaces-sdlc-list-artifact-types",
  "spaces-sdlc-create-artifact-type",
  "spaces-sdlc-write-artifact",
  "spaces-sdlc-archive-artifact",
  "spaces-sdlc-create-pull-request",
  "spaces-sdlc-list-entity-links",
  "spaces-sdlc-list-artifact-versions",
  "spaces-automations-list",
  "spaces-automation-get",
  "spaces-automation-runs",
  "spaces-automation-run",
  "spaces-automation-schema",
  "spaces-automation-validate",
  "spaces-automation-create",
  "spaces-automation-update",
  "spaces-automation-submit",
  "spaces-automation-versions",
  "spaces-automation-variables",
  "spaces-automation-webhook",
  "spaces-automation-webhook-issue",
  "spaces-automation-agents",
];

/** The tool names the Spaces MCP server lists under this process's env. */
export function spacesMcpToolNames(directVespaSearch: boolean = SERVER_ENV.directVespaSearch): string[] {
  const [first, ...rest] = SPACES_BASE_TOOL_NAMES;
  return [...(first ? [first] : []), ...(directVespaSearch ? SPACES_DIRECT_VESPA_TOOL_NAMES : []), ...rest];
}
