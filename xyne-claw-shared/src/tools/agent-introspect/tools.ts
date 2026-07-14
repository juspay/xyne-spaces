/**
 * Agent-introspection tool DEFINITIONS (catalog entries only).
 *
 * Execution lives in claw-auth (mcp/adapters/agent-introspect.ts derives its
 * McpToolInfo list from these and owns the handlers — they need prisma/org
 * context that the shared package must not depend on). Registering the
 * definitions here puts them in the single custom-tool source of truth, so
 * bootstrap-tools seeds them into the `tool` catalog and the agent-config
 * Toolbox picker can offer them — same split as `propose-agent-call`
 * (custom:orchestrator). xyne-claw excludes `custom:agent-introspect` from
 * in-process loading (custom-tools.ts), so the stub execute() never runs.
 */
import type { ToolDefinition } from "../types.js";

const AUTH_EXECUTED_STUB = async (): Promise<string> =>
  "agent-introspect tools are executed by claw-auth as System Tools; not available in-process.";

export const listAgentsTool: ToolDefinition = {
  slug: "list_agents",
  name: "list_agents",
  description:
    "List all agents with a summary of their configuration: slug, name, scope, enabled, model, " +
    "attached tools (subagents/direct/custom/gateway), skills and KB scope. Use this to survey the " +
    "fleet before recommending changes. Read-only.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      enabledOnly: { type: "boolean", description: "If true, only return enabled agents." },
    },
    required: [],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const getAgentConfigTool: ToolDefinition = {
  slug: "get_agent_config",
  name: "get_agent_config",
  description:
    "Get one agent's full configuration by slug: system prompt, config JSON (tools, model settings, " +
    "feature flags), attached skills and knowledge-base grants. Use after list_agents to inspect a " +
    "specific agent in detail. Read-only; secrets are never returned.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "The agent slug to inspect." },
      orgId: { type: "string", description: "Optional org id to disambiguate duplicate slugs." },
    },
    required: ["slug"],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const listAvailableToolsTool: ToolDefinition = {
  slug: "list_available_tools",
  name: "list_available_tools",
  description:
    "List the full catalog of tools, subagents and integrations that COULD be added to an agent — " +
    "including each integration's read/write tools, risk level and how many agents already use it " +
    "(usageCount). Compare against an agent's current config to recommend additions. Read-only.",
  source: "custom:agent-introspect",
  inputSchema: { type: "object", properties: {}, required: [] },
  execute: AUTH_EXECUTED_STUB,
};

export const getAgentRunsTool: ToolDefinition = {
  slug: "get_agent_runs",
  name: "get_agent_runs",
  description:
    "Run history evidence for routing: aggregates show whether the agent delivers (success rate, latency); " +
    "samples show what query shapes it solves. Samples are limited to runs you can see.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      agentSlug: { type: "string", description: "The agent slug to inspect run history for." },
      limit: { type: "number", description: "Maximum visible task samples to return. Default 5, max 10." },
    },
    required: ["agentSlug"],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const AGENT_INTROSPECT_TOOL_DEFS: ToolDefinition[] = [
  listAgentsTool,
  getAgentConfigTool,
  listAvailableToolsTool,
  getAgentRunsTool,
];
