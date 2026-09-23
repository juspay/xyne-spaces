/**
 * Names of the tools the xyne-workflows MCP exposes.
 *
 * Kept here rather than imported from the server module so the SDLC profile in
 * sdlc/registry.ts can grant them without the shared package depending on
 * claw-auth. xyne-workflows-tools.ts asserts this list matches what it serves,
 * so a tool added there fails the build until it is added here too.
 */
export const WORKFLOW_MCP_TOOL_NAMES = [
  "workflow_catalog",
  "workflow_node_context",
  "workflow_list",
  "workflow_get",
  "workflow_validate",
  "workflow_create",
  "workflow_update",
  "workflow_run",
  "workflow_run_get",
  "workflow_run_list",
  "workflow_step_events",
] as const;

/** The subset that writes; granted "allow" so workflow-triggered runs do not stall. */
export const WORKFLOW_MCP_WRITE_TOOL_NAMES = [
  "workflow_create",
  "workflow_update",
  "workflow_run",
] as const;
