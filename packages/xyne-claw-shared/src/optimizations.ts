/**
 * Catalog of claw's optimization switches, shared by the runtime and the
 * agent-config UI:
 *  - xyne-claw/src/optimizations.ts decides each switch per run (run pin →
 *    agent's own `config.optimizations` → XYNE_OPT_* env → tier default →
 *    `defaultOn`),
 *  - claw-auth serves this list at GET /api/v1/agents/optimizations, and the
 *    agent page renders one toggle per entry.
 *
 * Add a switch here and it gets a toggle in the dashboard with no UI change.
 * Pure data: no runtime imports, so any service can load it.
 */

export type OptimizationGroup = "answering" | "tools" | "context" | "routing" | "twin" | "messaging";

export interface OptimizationSpec {
  /** Short sentence-case name shown on the toggle. */
  label: string;
  /** One line: what changes when it is on. Always visible. */
  summary: string;
  /** Why / when to use it, and what it costs. Behind the row's "Details". */
  detail: string;
  group: OptimizationGroup;
  defaultOn: boolean;
  /**
   * "agent": read inside an agent's run, so an agent's own setting applies.
   * "fleet": read by a background job or a gate that runs before any agent
   * run, so only the XYNE_OPT_* env flag changes it.
   */
  scope: "agent" | "fleet";
  /** Another switch this one only has an effect under. */
  requires?: string;
}

export const OPTIMIZATION_GROUPS: ReadonlyArray<{ id: OptimizationGroup; title: string; description: string }> = [
  {
    id: "answering",
    title: "Answer checks",
    description: "What happens after the agent writes its reply, before it is delivered.",
  },
  {
    id: "tools",
    title: "Tool discovery",
    description: "How the agent finds tools it has not loaded yet. Grants no new access: only tools this agent already has are affected.",
  },
  {
    id: "context",
    title: "Tool results & long runs",
    description: "Keeping large results and long tool loops from crowding out the conversation.",
  },
  {
    id: "routing",
    title: "Routing & lookups",
    description: "Cheap checks that can skip an LLM call before the work starts.",
  },
  {
    id: "twin",
    title: "Digital twin & memory",
    description: "Only affects twin (@user) runs and the memory that feeds them.",
  },
  {
    id: "messaging",
    title: "Messaging channels",
    description: "How progress reaches people on channels that show nothing while the agent works.",
  },
];

export const OPTIMIZATIONS = {
  jev_tool_sift: {
    label: "Rank tool search with Jev",
    summary: "search-tools adds the tools Jev scores as relevant on top of keyword matches.",
    detail: "Helps when a request doesn't use a tool's own words. If Jev is unavailable, search returns keyword matches only.",
    group: "tools",
    defaultOn: true,
    scope: "agent",
  },
  jev_compaction: {
    label: "Jev-assisted compaction",
    summary: "When a long conversation is compacted, Jev first picks which tool calls and results to keep before falling back to an LLM summary.",
    detail: "Faster and cheaper than summarising everything with the LLM. If Jev is unavailable, compaction uses the LLM summary as before.",
    group: "context",
    defaultOn: true,
    scope: "agent",
  },
  jev_auto_continue: {
    label: "Auto-continue unfinished answers",
    summary: "When Jev judges the final reply incomplete, the agent gets one hidden nudge to finish the work.",
    detail: "Jev asks three questions about the reply: did it deliver the result, does it read as finished, is it only a statement of intent. Anything short of complete earns one extra turn. Never applies to twin deliveries or structured output. Turn it off if replies that ask a question or report \"nothing found\" are being pushed into extra work.",
    group: "answering",
    defaultOn: true,
    scope: "agent",
  },
  auto_continue_strict: {
    label: "Strict auto-continue",
    summary: "Only nudge replies that announce work without doing it or stop partway, not finished replies Jev merely thinks missed the question.",
    detail: "Use when the agent often answers with a clarifying question, a \"not found\", or a deliberately narrowed result that should not be pushed further.",
    group: "answering",
    defaultOn: false,
    scope: "agent",
    requires: "jev_auto_continue",
  },
  jev_result_sift: {
    label: "Filter large tool results",
    summary: "Large list results from search tools are filtered to the items relevant to this conversation before the agent reads them.",
    detail: "The full result is always saved to a file first, and the agent can ask for the raw result on any call.",
    group: "context",
    defaultOn: false,
    scope: "agent",
  },
  jev_verify_prefilter: {
    label: "Fast pre-check for verification",
    summary: "Verify responses asks Jev first: drafts Jev is confident are fine are delivered without the LLM verifier.",
    detail: "Only matters when Verify responses (Behaviour → Answering) is on. Other drafts still go to the LLM verifier; when it is unavailable, a draft Jev rates high-risk is sent back instead of passing unchecked.",
    group: "answering",
    defaultOn: false,
    scope: "agent",
  },
  jev_twin_gate: {
    label: "Twin respond/skip gate",
    summary: "Before a twin replies, Jev scores the message: 0.7 or above runs the twin, 0.3 or below skips it as noise, anything between goes to the LLM gate.",
    detail: "If Jev is unavailable, every message goes to the LLM gate as before.",
    group: "twin",
    defaultOn: true,
    scope: "fleet",
  },
  jev_twin_delivery_check: {
    label: "Twin delivery check",
    summary: "Every accepted twin delivery is scored by Jev (answers the ask, grounded, right destination) and the scores travel with it to the approver.",
    detail: "Advisory only: it never blocks a delivery.",
    group: "twin",
    defaultOn: true,
    scope: "agent",
  },
  jev_memory_candidate_check: {
    label: "Memory candidate check",
    summary: "New memory candidates are compared with the user's most similar memories: duplicates and noise are dropped, the rest are ranked.",
    detail: "Auto-approval also requires the Jev score.",
    group: "twin",
    defaultOn: true,
    scope: "fleet",
  },
  jev_memory_file_pick: {
    label: "Pick persona files per message",
    summary: "A twin run loads only the persona files Jev scores as needed for this message (up to 3, soul.md always) instead of the fixed toggled set.",
    detail: "If Jev is unavailable, the twin loads the toggled set.",
    group: "twin",
    defaultOn: true,
    scope: "agent",
  },
  jev_memory_update_check: {
    label: "Nightly persona rewrite check",
    summary: "Each nightly persona-file rewrite is scored against the old file and the approved facts; a rewrite Jev rejects keeps the old file.",
    detail: "Runs in the nightly memory job, outside any agent run.",
    group: "twin",
    defaultOn: true,
    scope: "fleet",
  },
  jev_context_gate: {
    label: "Check context before answering",
    summary: "Before an answer is accepted, Jev checks whether the gathered evidence supports it; if it clearly does not, the agent is nudged once to fetch more.",
    detail: "Adds one classifier call per answer and at most one extra turn. If Jev is unavailable, the answer is accepted as before.",
    group: "answering",
    defaultOn: false,
    scope: "agent",
  },
  jev_mode_router: {
    label: "Jev mode routing",
    summary: "Plain-text messages are routed to /review, /learn or no mode by Jev when it is confident; otherwise the LLM router decides.",
    detail: "Saves the LLM router call on clear-cut messages.",
    group: "routing",
    defaultOn: true,
    scope: "agent",
  },
  jev_goal_prefilter: {
    label: "Goal done-check pre-filter",
    summary: "A /goal loop's done-check asks Jev first; only when Jev is unsure does the LLM judge run.",
    detail: "The judge is called by claw-auth between goal turns, outside the agent's run.",
    group: "routing",
    defaultOn: true,
    scope: "fleet",
  },
  jev_prefetch_gate: {
    label: "Prefetch gate",
    summary: "Jev checks whether the first message names anything worth looking up; a clear no skips the LLM entity extractor.",
    detail: "Only matters when Prefetch context (Behaviour → Context) is on.",
    group: "routing",
    defaultOn: true,
    scope: "agent",
  },
  jev_checkpoint_precheck: {
    label: "Checkpoint pre-check",
    summary: "When a final answer looks like a compaction checkpoint, Jev checks first; if it is clearly a real answer, the extra correction turn is skipped.",
    detail: "Saves an LLM turn on long runs that compacted near the end.",
    group: "answering",
    defaultOn: true,
    scope: "agent",
  },
  jev_tool_progress: {
    label: "Detect stalled tool loops",
    summary: "On long tool loops, Jev scores whether recent calls still make progress; clear stalls get the converge nudge early.",
    detail: "Without it, the nudge waits for a fixed call count.",
    group: "context",
    defaultOn: false,
    scope: "agent",
  },
  catalog_full_index: {
    label: "Full tool index",
    summary: "List every loadable tool by name in the prompt, so the agent loads the right one directly instead of guessing with searches.",
    detail: "The index is fitted to a size budget. Without it, catalogs of more than 15 tools collapse to a single line.",
    group: "tools",
    defaultOn: false,
    scope: "agent",
  },
  subagent_read_tools: {
    label: "Direct subagent tools",
    summary: "Let the agent search and load its subagents' tools and call them itself, instead of waiting on a slow nested subagent run.",
    detail: "Writes included. Each tool keeps its permission and approval settings, and nothing outside the agent's grant is added.",
    group: "tools",
    defaultOn: false,
    scope: "agent",
  },
  subagent_direct_only: {
    label: "No built-in subagents",
    summary: "Built-in server subagents (spaces, bitbucket, …) are not offered; their tools are catalogued and the agent loads and calls them itself.",
    detail: "No run waits on a nested subagent. Custom subagents are kept.",
    group: "tools",
    defaultOn: false,
    scope: "agent",
  },
  interim_messages: {
    label: "Send interim messages",
    summary: "Text the model writes alongside a tool call is sent as soon as that turn ends, and only the last turn is kept as the final answer.",
    detail: "For messaging channels such as WhatsApp, where nothing else shows progress.",
    group: "messaging",
    defaultOn: false,
    scope: "agent",
  },
  lean_palette: {
    label: "Lean open palette",
    summary: "With the open palette on, tools it admitted (not ones the agent was granted) stay hidden in the catalog, write tools included.",
    detail: "Under a reads+writes palette the forced spaces wrapper is also dropped, since its tools load directly. Only matters when the agent uses the open palette.",
    group: "tools",
    defaultOn: false,
    scope: "agent",
  },
  active_tool_cap: {
    label: "Top-25 active tools",
    summary: "Start each run with only the agent's 25 most-used tools of the last 7 days; the rest stay listed by name and load with one call.",
    detail: "Every request gets smaller and nothing is removed from the agent. On by default for orchestrators.",
    group: "tools",
    defaultOn: false,
    scope: "agent",
  },
} as const satisfies Record<string, OptimizationSpec>;

export type OptimizationKey = keyof typeof OPTIMIZATIONS;
export const OPTIMIZATION_KEYS = Object.keys(OPTIMIZATIONS) as OptimizationKey[];

/**
 * Defaults that follow from an agent's delegation tier. They sit below every
 * explicit choice (the run's spec, the agent's own setting, XYNE_OPT_* env)
 * and above `defaultOn`.
 */
export const OPTIMIZATION_TIER_DEFAULTS: Readonly<Record<string, Partial<Record<OptimizationKey, boolean>>>> = {
  orchestrator: { active_tool_cap: true },
};

/** Every switch as a flat list, in catalog order. */
export function optimizationCatalog(): Array<OptimizationSpec & { key: OptimizationKey }> {
  return OPTIMIZATION_KEYS.map((key) => ({ key, ...(OPTIMIZATIONS[key] as OptimizationSpec) }));
}
