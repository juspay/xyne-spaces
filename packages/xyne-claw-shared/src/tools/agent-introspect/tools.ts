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
    "so drift is visible instead of averaged away. Pass `days` to size the window.\n\n" +
    "For per-tool reliability, LLM-call latency, token usage with sample sizes, or the sessions behind a " +
    "figure, use get_agent_metrics and find_metric_sessions.",
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

export const getFleetStatsTool: ToolDefinition = {
  slug: "get_fleet_stats",
  name: "get_fleet_stats",
  description:
    "Fleet-wide health of every agent in this organization over a recent window, from the run ledger " +
    "(agent_runs), compared with a baseline of the preceding days. One call returns: overall runs, " +
    "failure %, p50/p95 run duration and where run time goes (LLM wait, LLM generation, tools, other); " +
    "a per-agent table (runs, failed, cancelled, failure %, p50/p95, LLM wait, time to first token, tool " +
    "time, turns, retries, tokens, ratings, change vs baseline); the slowest agents with the dominant " +
    "cause of their run time and top retry reasons; the top normalised error messages with counts, " +
    "affected agents, first/last seen and example session ids; the most-used tools (runs using each, and " +
    "which agents); and per provider/model failure %, retries, time to first token " +
    "and tokens/sec. Use it for daily fleet reports and \"which agents are failing or slow and why\". " +
    "Restricted to claw admins. Read-only. For one tool's failure classes, per-LLM-call latency or " +
    "the sessions behind a figure, use get_agent_metrics and find_metric_sessions.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      hours: { type: "number", description: "Window length in hours, ending now. Default 24, max 168." },
      baselineDays: {
        type: "number",
        description: "Days before the window used as the comparison baseline. Default 7, max 30.",
      },
      agentSlugs: {
        type: "array",
        items: { type: "string" },
        description: "Optional: only these agents. Omit for the whole fleet.",
      },
      topErrors: { type: "number", description: "How many error groups to return. Default 15, max 50." },
      topTools: { type: "number", description: "How many tools to return. Default 15, max 50." },
      maxAgents: { type: "number", description: "Maximum agents in the per-agent table. Default 60, max 200." },
    },
    required: [],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const getAgentDiagnosticsTool: ToolDefinition = {
  slug: "get_agent_diagnostics",
  name: "get_agent_diagnostics",
  description:
    "Deep diagnosis of ONE agent over a recent window, from the run ledger: run outcomes (failed, cancelled, " +
    "stuck, as-subagent, triggers, providers); latency (p50/p95/max, share of time in LLM vs tools, and how " +
    "many runs have no timing recorded); effort (turns, input-token context size, cache share, tool calls " +
    "per run, LLM retries and reasons); run errors grouped with a cause category, a fix hint and example " +
    "sessions; each failing tool with its error kinds (wrong path/branch, bad arguments, unknown tool, " +
    "missing connection, credentials, permissions, timeout, rate limit, …), a sample error and a fix hint; " +
    "the slowest tools; rating comments; and the slowest and heaviest-context sessions. Use it after " +
    "get_fleet_stats to explain what is going wrong with an agent and what to change. Categories and hints " +
    "are heuristics — confirm with an example session before recommending a fix. Restricted to claw admins. Read-only.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      agentSlug: { type: "string", description: "The agent to diagnose." },
      days: { type: "number", description: "Window in days, ending now. Default 7, max 30." },
      sampleRuns: { type: "number", description: "How many recent runs to scan for tool-level errors. Default 60, max 150." },
    },
    required: ["agentSlug"],
  },
  execute: AUTH_EXECUTED_STUB,
};

/**
 * The first sentence of each description is what the lazy tool catalog lists. Names must
 * classify as `read` under classifyToolRisk (no "set", "star", "cancel", "add", "post", "drop"...).
 */
export const GET_AGENT_METRICS_VIEWS = ["overview", "tools", "tool_failures", "llm", "coverage"] as const;
export const GET_AGENT_METRICS_SORTS = ["errors", "errorRate", "calls", "p95", "recoveryRate", "contextBytes"] as const;
export const FIND_METRIC_SESSIONS_KINDS = ["tool_errored", "tool_recovered", "tool_dropped", "tool_called", "run_failed", "run_slow"] as const;
export const METRICS_TOOL_DAYS = [1, 7, 30] as const;

export const getAgentMetricsTool: ToolDefinition = {
  slug: "get_agent_metrics",
  name: "get_agent_metrics",
  description:
    "Run, tool and LLM-call performance metrics for agents in this organization, computed from the run " +
    "ledger over a recent window. Use for \"how is agent X doing this week\", \"which tool fails most and " +
    "why\", \"p95 latency / token usage / success rate\", \"which granted tools are never called\". " +
    "Admins get the whole org; everyone else gets their own runs only (the response says " +
    "which in `scope`). Every figure carries its sample size `n`; a null figure means too few samples or " +
    "nothing to divide by, not zero. Read `coverage` and `caveats` before quoting a number. For the " +
    "sessions behind a figure call find_metric_sessions (the response's `next` gives the exact call). Read-only.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      view: {
        type: "string",
        enum: [...GET_AGENT_METRICS_VIEWS],
        description:
          "overview = runs, success rate, latency, tokens, worst tools (default). tools = per-tool " +
          "calls/errors/recovered/p95, ranked. tool_failures = failure classes for ONE tool (needs `tool`). " +
          "llm = per-LLM-call first-token wait, throughput, cache hit, retries by model. coverage = " +
          "granted-but-never-called tools per agent.",
      },
      agentSlug: {
        type: "string",
        description: "One agent's slug. Omit for the whole org (admin) or all your runs.",
      },
      days: { type: "number", enum: [...METRICS_TOOL_DAYS], description: "Window in days ending now. Default 7." },
      tool: {
        type: "string",
        description: "Exact tool name as the metrics report it, e.g. 'webfetch'. Required for tool_failures; narrows coverage.",
      },
      sortBy: {
        type: "string",
        enum: [...GET_AGENT_METRICS_SORTS],
        description: "tools view only. Default errors.",
      },
      limit: { type: "number", description: "Top-N rows for ranked lists. Default 8, max 25." },
      includeSubagents: {
        type: "boolean",
        description: "llm view: include subagent LLM calls. Default false (parent calls only).",
      },
    },
    required: [],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const findMetricSessionsTool: ToolDefinition = {
  slug: "find_metric_sessions",
  name: "find_metric_sessions",
  description:
    "List the sessions (runs) behind a metric, newest first (slowest first for run_slow), paginated. Use " +
    "after get_agent_metrics: \"show sessions where webfetch errored\", \"which sessions recovered a failed " +
    "tool call\", \"slowest runs this week\", \"failed runs of agent X\". Same scope as get_agent_metrics: " +
    "admins see the org's runs, everyone else their own. Task and error text appear only for your own runs " +
    "and scheduled or automation runs; other rows show figures only. Pass the returned `page.cursor` to get " +
    "the next page. Read-only.",
  source: "custom:agent-introspect",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...FIND_METRIC_SESSIONS_KINDS],
        description:
          "tool_errored = a call to `tool` returned an error. tool_recovered = an error was followed by a " +
          "later success of the same tool in that run. tool_dropped = the tool's end event was lost (result " +
          "unknown). tool_called = any call to `tool`. run_failed = run status failed or cancelled. " +
          "run_slow = slowest completed runs by end-to-end time.",
      },
      tool: { type: "string", description: "Exact tool name. Required for the tool_* kinds." },
      agentSlug: { type: "string", description: "Restrict to one agent." },
      days: { type: "number", enum: [...METRICS_TOOL_DAYS], description: "Window in days ending now. Default 7." },
      limit: { type: "number", description: "Page size. Default 10, max 25." },
      cursor: {
        type: "string",
        description: "Opaque `page.cursor` from the previous page, to continue the same list. Omit for page 1.",
      },
    },
    required: ["kind"],
  },
  execute: AUTH_EXECUTED_STUB,
};

export const AGENT_INTROSPECT_TOOL_DEFS: ToolDefinition[] = [
  listAgentsTool,
  getAgentConfigTool,
  searchToolsTool,
  getAgentRunsTool,
  findAgentsTool,
  getFleetStatsTool,
  getAgentDiagnosticsTool,
  getAgentMetricsTool,
  findMetricSessionsTool,
];
