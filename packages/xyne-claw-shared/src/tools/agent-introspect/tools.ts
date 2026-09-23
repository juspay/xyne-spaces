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

export const searchToolsTool: ToolDefinition = {
  slug: "search_tools",
  name: "search_tools",
  description:
    "Find tools in this organization's catalog — every tool any agent here could be given, " +
    "with the exact slugs you need to write into an agent's config.\n" +
    "Omit `query` to browse the catalog. Pass `query` to search it semantically: describe what the " +
    'agent needs to DO ("post a message to a channel", "read a pdf form") rather than guessing a ' +
    "tool name, because matching is on meaning, not on keywords.\n" +
    "`integration` narrows to one product (google, sandbox, github). `maxRisk` is a ceiling, not an " +
    'exact match: "read" excludes everything that writes, "write" still excludes destructive. Use it ' +
    "when recommending tools for an agent that should not mutate anything.\n" +
    "Every result carries its slug, integration, risk, required parameters, and how many agents in " +
    "this org already hold it — which is the fastest signal for whether a tool is the conventional " +
    "choice here. Subagents and the integration list come back alongside, since an agent's config " +
    "grants those by name too. Read-only.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What the agent needs to do, in plain words. Omit to browse the catalog.",
      },
      integration: {
        type: "string",
        description: 'Restrict to one integration, e.g. "google" or "sandbox".',
      },
      maxRisk: {
        type: "string",
        enum: ["read", "write", "destructive"],
        description: "Ceiling on how dangerous a returned tool may be. Omit for no ceiling.",
      },
      limit: { type: "number", description: "Maximum tools to return. Default 15, max 50." },
    },
    required: [],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const getAgentRunsTool: ToolDefinition = {
  slug: "get_agent_runs",
  name: "get_agent_runs",
  description:
    "Run history evidence for routing: aggregates show whether the agent delivers (success rate, latency); " +
    "samples show what query shapes it solves. Samples are limited to runs you can see.\n\n" +
    "LATENCY. `aggregates` carries p50/p95 wall-clock plus the median split between model time " +
    "(`p50LlmMs`) and tool time (`p50ToolMs`) — that split says whether a slow agent is waiting on the " +
    "model or on its own tool loop. `perDay` gives the same p50/p95 per calendar day over the window, " +
    "so drift is visible instead of averaged away. Pass `days` to size the window.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      agentSlug: { type: "string", description: "The agent slug to inspect run history for." },
      limit: { type: "number", description: "Maximum visible task samples to return. Default 5, max 10." },
      days: {
        type: "number",
        description: "Window in days for aggregates and perDay. Default 30, min 1, max 90.",
      },
    },
    required: ["agentSlug"],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const findAgentsTool: ToolDefinition = {
  slug: "find_agents",
  name: "find_agents",
  description:
    "Semantic search over this organization's agents. Describe the work in plain language and get a " +
    "ranked shortlist of the agents best equipped for it. Prefer this over listing the whole roster.\n\n" +
    "HOW IT WORKS. Every agent is indexed as up to three documents, and your query is matched against " +
    "all of them by meaning, not keywords:\n" +
    "  • usage    — what people have actually asked this agent to do, distilled from its real run " +
    "history. Absent for agents with too little history.\n" +
    "  • persona  — the agent's full instructions, verbatim.\n" +
    "  • identity — its name, stated purpose, granted tools, skills and knowledge grants.\n" +
    "An agent is scored by its single best-matching passage, so a long set of instructions gains no " +
    "advantage from length. Results are sorted by that score.\n\n" +
    "WHAT YOU GET BACK, per agent: `slug` (pass this to call it), `score`, `matchedOn` (which " +
    "documents matched, most telling first), `purpose` (its identity document), `usage` (its usage " +
    "document, or null), `capabilities` (every tool it holds) and `excerpt` (the matching passage). " +
    "Read `purpose` and `usage` and judge the fit yourself — the score orders candidates, it does not " +
    "decide correctness.\n\n" +
    "IMPORTANT. Scoring is semantic, so a confident-sounding agent can outrank a capable one. When " +
    "the work is impossible without a specific integration, put that tool in `requiredToolSlugs` " +
    "rather than trusting the ranking — it is an exact filter and cannot be talked past. Being " +
    "listed here does not mean you can call it; the delegation tool's own parameter list is the " +
    "authority on that. Read-only.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      taskDescription: {
        type: "string",
        description:
          "The work to be done, in plain language — the capability, system or subject matter it " +
          "needs. Describe the task as the user would; this is matched by meaning, so a full " +
          "sentence works better than keywords, and a slug works worst.",
      },
      requiredToolSlugs: {
        type: "array",
        items: { type: "string" },
        description:
          "Exact tool slugs the agent MUST hold — every one of them, not any. An agent lacking one " +
          "is excluded outright regardless of how well it matches. Take slugs verbatim from a " +
          "previous result's `capabilities` or from the tool catalog; a guessed slug matches nothing " +
          "and silently empties the result.",
      },
      searchDocumentKinds: {
        type: "array",
        items: { type: "string", enum: ["usage", "persona", "identity"] },
        description:
          "Restrict which of the three documents may match. Omit to search all. Narrow to `usage` to " +
          "find an agent by what people demonstrably bring it rather than by what it claims — useful " +
          "when several agents describe themselves similarly. To rank observed use above claimed " +
          "purpose, call twice — once with [\"usage\"], then once without it — and read the first " +
          "result set as the stronger evidence. CAVEAT: a usage document only exists for agents with " +
          "enough run history, so a `usage`-only search silently omits every agent that has none. " +
          "Treat its results as a shortlist to prefer, never as the full set of capable agents.",
      },
      maxResults: {
        type: "number",
        description: "Maximum agents to return. Default 5, maximum 20.",
      },
    },
    required: ["taskDescription"],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const AGENT_INTROSPECT_TOOL_DEFS: ToolDefinition[] = [
  listAgentsTool,
  getAgentConfigTool,
  searchToolsTool,
  getAgentRunsTool,
  findAgentsTool,
];
