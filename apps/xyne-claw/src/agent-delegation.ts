/**
 * Agent-to-Agent (A2A) delegation — the "one heavy loop at a time" governor
 * and the callable-agent tool factory.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM SUBAGENTS (subagent-tools.ts)
 * ─────────────────────────────────────────────────────────────────────────
 * Subagents are CHEAP and PARALLEL by design:
 *   - makeSubagentTool() tags each tool "[Subagent — nested LLM run, expensive]"
 *     and tells the parent to BATCH them / fire them in ONE turn so they run
 *     concurrently.
 *   - identical (subagent, question) pairs SHARE one in-flight promise
 *     (subagentResultCache), so fan-out is close to free.
 *
 * Callable AGENTS are the opposite: each is a FULL agent loop with its own
 * system prompt, toolset, MCP servers and provider — a genuinely heavy,
 * expensive nested run. So the governance is inverted:
 *   - CONCURRENCY = 1: at most one agent delegation runs at a time per parent
 *     run. If the model fires two in one turn, they SERIALIZE (a mutex), they
 *     do NOT run in parallel.
 *   - DEPTH CAP (default 1): a callee cannot itself delegate to another agent.
 *     No A → B → C. (Subagents already forbid nesting; this is the A2A analog.)
 *   - COUNT BUDGET: a hard cap on total delegations per parent run.
 *   - CYCLE GUARD: an agent already on the delegation stack cannot be called
 *     again (no A → A, and at higher caps no A → B → A).
 *   - Flipped tool tag: "delegate to at most ONE at a time, do NOT batch".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THIS PLUGS IN (production wiring)
 * ─────────────────────────────────────────────────────────────────────────
 *  1. claw-auth  (xyne-claw-auth/backend/src/routes/run.ts): resolve the
 *     agents the running agent is ALLOWED to delegate to. Standard callers get
 *     full, grant-approved `CallableAgentSpec[]` rows. Orchestrator-tier callers
 *     get lightweight specs and a generic `call-agent` tool; the selected
 *     callee's full spec is fetched from claw-auth at execute time after the
 *     resolver re-checks authorization server-side.
 *  2. xyne-claw  (routes/run.ts + agent.ts tool assembly): call
 *     buildCallableAgentTools() alongside buildSubagentTools() and splice the
 *     result into the parent palette (and the global `tools:[...]` allowlist).
 *  3. The NestedAgentRunner is wired to spawn a fresh pi agent session seeded
 *     from the callee agent definition — mirroring makeSubagentTool's
 *     createAgentSession() call — running a SINGLE blocking session.prompt().
 *     The parent's tool `execute()` awaits it: that await IS the
 *     "pause → wait for result → resume" the feature asks for.
 *
 * This module has NO runtime dependency on the pi packages so it stays unit-
 * testable in isolation. `CallableAgentTool` is structurally compatible with
 * pi's `ToolDefinition` (name/label/description/parameters/execute), so the
 * factory output drops straight into the parent tool array.
 */

// ── Structural tool shape (compatible with pi ToolDefinition) ──────────────

export interface ToolResultContent {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

export interface CallableAgentTool {
  name: string;
  label: string;
  description: string;
  progressLabels?: string[];
  parameters: unknown;
  execute(toolCallId: string, params: unknown): Promise<ToolResultContent>;
}

// ── Wire contract ──────────────────────────────────────────────────────────

/** How the callee run is attributed. Default 'user' = callee runs under the
 *  SAME human user as the top-level run (a callee can never exceed what the
 *  human is already allowed — contains the confused-deputy risk). 'callee_app'
 *  runs it under the callee agent's own app identity (opt-in, per grant). */
export type DelegationIdentityMode = "user" | "callee_app";

/** A full agent the running agent is allowed to delegate to. Resolved by
 *  claw-auth from the `agents` table + RBAC grant and forwarded in /run. */
export interface CallableAgentSpec {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  agentConfig?: Record<string, unknown>;
  /** Tool param the parent fills with the delegated task. Defaults to "task". */
  paramName?: string;
  paramDescription?: string;
  model?: string;
  provider?: string;
  providerOrder?: string[];
  providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }>;
  subagentProviders?: Record<string, string>;
  customSubagents?: Array<{
    name: string;
    description: string;
    progressLabels: string[];
    systemPrompt: string;
    paramName: string;
    paramDescription: string;
    tools: { direct?: string[]; custom?: string[] };
    mcpInstanceMap?: Record<string, string>;
    skills: Array<{ slug: string; name: string; description: string; content: string }>;
  }>;
  skills?: Array<{
    slug?: string;
    name: string;
    description?: string;
    content: string;
    files?: Array<{ relativePath: string; content: string; contentType?: string | null }>;
  }>;
  sessionToken?: string;
  spacesAppId?: string | null;
  identityMode?: DelegationIdentityMode;
  progressLabels?: string[];
}

export interface CallableAgentLightSpec {
  slug: string;
  name: string;
  description: string;
  /** Tool param the parent fills with the delegated task. Defaults to "task". */
  paramName?: string;
  paramDescription?: string;
  identityMode?: DelegationIdentityMode;
  progressLabels?: string[];
}

/** Injected implementation that actually runs the callee agent loop. In prod
 *  this spawns a nested pi session seeded from `spec` and returns the callee's
 *  final assistant text. In tests/POT a stub simulates the callee. */
export type NestedAgentRunner = (args: {
  spec: CallableAgentSpec;
  question: string;
  /** Depth at which the callee will run (parent depth + 1). */
  depth: number;
  /** Governor to hand the callee so ITS own delegation attempts are governed
   *  (and, at the depth cap, refused). */
  childGovernor: AgentDelegationGovernor;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}) => Promise<{ text: string; toolsUsed?: string[] }>;

// ── Observability ───────────────────────────────────────────────────────────

export type DelegationEventKind =
  | "requested"     // parent asked to delegate
  | "blocked"       // refused by a guard (depth / budget / cycle)
  | "queued"        // waiting on the concurrency-1 mutex
  | "started"       // callee loop began
  | "completed"     // callee loop returned
  | "failed";       // callee loop threw

export interface DelegationEvent {
  ts: number;
  kind: DelegationEventKind;
  caller: string;
  callee: string;
  depth: number;
  reason?: string;
  detail?: string;
}

export type DelegationEventSink = (ev: DelegationEvent) => void;

// ── Config ──────────────────────────────────────────────────────────────────

export interface DelegationGovernorOptions {
  /** Max delegation depth. 1 = a callee cannot delegate further. */
  maxDepth?: number;
  /** Hard cap on total delegations across the whole parent run. */
  maxDelegationsPerRun?: number;
  /** Depth of THIS governor (0 at the top-level run). */
  depth?: number;
  /** Slugs already on the delegation stack (for the cycle guard). */
  visited?: string[];
  /** Slug of the agent that owns this governor (the caller at this level). */
  ownerSlug?: string;
  onEvent?: DelegationEventSink;
  /** Shared across the whole run tree so the count budget is global, not
   *  per-level. Created internally when omitted. */
  sharedCounter?: { count: number };
}

export const A2A_DEFAULTS = {
  MAX_DEPTH: 1,
  MAX_DELEGATIONS_PER_RUN: 3,
  CONCURRENCY: 1, // fixed: agents are heavy; one loop at a time.
} as const;

/**
 * Bounds for the per-agent, per-run delegation budget. The default
 * (A2A_DEFAULTS.MAX_DELEGATIONS_PER_RUN) applies when an agent has not set a
 * value. The upper bound is a cost/blast-radius guard: each delegation is a full
 * nested agent run, so an unbounded budget could fan out an expensive tree.
 * Keep these values in sync with the dashboard behaviour-config helper
 * (apps/dashboard/src/services/claw/behaviourConfig.ts).
 */
export const MAX_DELEGATIONS_PER_RUN_BOUNDS = {
  MIN: 1,
  MAX: 25,
  DEFAULT: A2A_DEFAULTS.MAX_DELEGATIONS_PER_RUN,
} as const;

/**
 * Coerce an untrusted config value (from an agent's free-form config bag) into a
 * valid delegation budget. Non-integers, out-of-range, and missing values fall
 * back to the default; in-range values are clamped to [MIN, MAX].
 */
export function clampMaxDelegationsPerRun(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT;
  }
  return Math.min(
    MAX_DELEGATIONS_PER_RUN_BOUNDS.MAX,
    Math.max(MAX_DELEGATIONS_PER_RUN_BOUNDS.MIN, n),
  );
}

/**
 * Per-parent-run governor. One instance is created for the top-level run and
 * threaded through progressCtx. `childGovernor()` produces the governor handed
 * to a callee so the whole tree shares one count budget and one visited stack.
 */
export class AgentDelegationGovernor {
  readonly maxDepth: number;
  readonly maxDelegationsPerRun: number;
  readonly depth: number;
  readonly ownerSlug: string;
  private readonly visited: Set<string>;
  private readonly onEvent: DelegationEventSink | undefined;
  private readonly sharedCounter: { count: number };

  /** Tail of the mutex chain. Every exclusive section awaits the previous one,
   *  so concurrency is pinned to 1 regardless of how many tool calls the model
   *  fires in a single turn. */
  private queueTail: Promise<void> = Promise.resolve();

  constructor(opts: DelegationGovernorOptions = {}) {
    this.maxDepth = opts.maxDepth ?? A2A_DEFAULTS.MAX_DEPTH;
    this.maxDelegationsPerRun = opts.maxDelegationsPerRun ?? A2A_DEFAULTS.MAX_DELEGATIONS_PER_RUN;
    this.depth = opts.depth ?? 0;
    this.ownerSlug = opts.ownerSlug ?? "root";
    this.visited = new Set(opts.visited ?? []);
    this.onEvent = opts.onEvent;
    this.sharedCounter = opts.sharedCounter ?? { count: 0 };
  }

  /** True when this level is allowed to expose callable-agent tools at all.
   *  At the depth cap we expose NONE, so a callee never even sees a delegate
   *  tool — the cleanest way to enforce depth=1. */
  canExposeDelegationTools(): boolean {
    return this.depth < this.maxDepth;
  }

  get delegationsUsed(): number {
    return this.sharedCounter.count;
  }

  emit(ev: DelegationEvent): void {
    try {
      this.onEvent?.(ev);
    } catch {
      /* observability must never break the run */
    }
  }

  /** Pre-flight authorization for a single delegation. Returns a machine- and
   *  human-readable reason on refusal so the parent tool can hand it back to
   *  the LLM instead of throwing. */
  canDelegate(calleeSlug: string): { ok: true } | { ok: false; reason: string } {
    if (this.depth >= this.maxDepth) {
      return {
        ok: false,
        reason: `depth cap reached (maxDepth=${this.maxDepth}); a delegated agent cannot itself delegate.`,
      };
    }
    if (this.sharedCounter.count >= this.maxDelegationsPerRun) {
      return {
        ok: false,
        reason: `delegation budget exhausted (${this.maxDelegationsPerRun} per run). Finish with the information you have.`,
      };
    }
    if (this.visited.has(calleeSlug) || this.ownerSlug === calleeSlug) {
      return {
        ok: false,
        reason: `cycle guard: '${calleeSlug}' is already on the delegation stack.`,
      };
    }
    return { ok: true };
  }

  /** Reserve one unit of the count budget. Call AFTER canDelegate() passes and
   *  BEFORE running, so two racing calls can't both slip past the budget. */
  reserve(): void {
    this.sharedCounter.count += 1;
  }

  /** Serialize `fn` behind the concurrency-1 mutex. If another delegation is
   *  in flight, this awaits it first (queued), then runs. Guarantees exactly
   *  one heavy agent loop executes at a time within the run. */
  async runExclusive<T>(onQueued: () => void, fn: () => Promise<T>): Promise<T> {
    const prior = this.queueTail;
    let release!: () => void;
    this.queueTail = new Promise<void>((r) => (release = r));
    // If `prior` is not already settled, we are about to wait — signal queued.
    let settled = false;
    void prior.then(() => (settled = true));
    await Promise.resolve();
    if (!settled) onQueued();
    try {
      await prior;
      return await fn();
    } finally {
      release();
    }
  }

  /** Governor to hand a callee running at depth+1. Shares the count budget and
   *  extends the visited stack with the callee's slug. */
  childGovernor(calleeSlug: string): AgentDelegationGovernor {
    return new AgentDelegationGovernor({
      maxDepth: this.maxDepth,
      maxDelegationsPerRun: this.maxDelegationsPerRun,
      depth: this.depth + 1,
      ownerSlug: calleeSlug,
      visited: [...this.visited, calleeSlug],
      ...(this.onEvent ? { onEvent: this.onEvent } : {}),
      sharedCounter: this.sharedCounter,
    });
  }
}

// ── Tool factory ────────────────────────────────────────────────────────────

/** Flipped counterpart of the "[Subagent … batch/parallel]" tag. Tells the
 *  parent LLM that agents are heavy and must be called one at a time. */
export function callableAgentDescription(spec: CallableAgentSpec): string {
  return (
    `[Agent delegation — heavyweight full agent loop] Delegate a self-contained task to the '${spec.name}' agent. ${spec.description} ` +
    `Delegate to AT MOST ONE agent at a time and do NOT batch agent calls in a single turn — ` +
    `each runs a full, expensive agent loop and they are serialized. Wait for the result before deciding whether another delegation is needed.`
  );
}

const paramSchema = (spec: CallableAgentSpec): unknown => ({
  type: "object",
  additionalProperties: false,
  required: [spec.paramName ?? "task"],
  properties: {
    [spec.paramName ?? "task"]: {
      type: "string",
      description:
        spec.paramDescription ??
        `The complete, self-contained task for ${spec.name}. Include all context it needs — it does not see this conversation.`,
    },
  },
});

async function runGovernedDelegation(args: {
  spec: CallableAgentSpec;
  question: string;
  governor: AgentDelegationGovernor;
  runner: NestedAgentRunner;
  opts?: { signal?: AbortSignal; onProgress?: (label: string) => void };
}): Promise<ToolResultContent> {
  const { spec, question, governor, runner, opts = {} } = args;
  const caller = governor.ownerSlug;
  governor.emit({
    ts: Date.now(),
    kind: "requested",
    caller,
    callee: spec.slug,
    depth: governor.depth,
    detail: question.slice(0, 120),
  });

  // 1) Pre-flight guards (depth / budget / cycle). Hand refusals back to
  //    the LLM as tool output — never throw — so it can adapt.
  const verdict = governor.canDelegate(spec.slug);
  if (!verdict.ok) {
    governor.emit({
      ts: Date.now(), kind: "blocked", caller, callee: spec.slug, depth: governor.depth, reason: verdict.reason,
    });
    return {
      isError: true,
      content: [{ type: "text", text: `Delegation to '${spec.name}' refused: ${verdict.reason}` }],
      details: {},
    };
  }

  // 2) Reserve budget, then serialize behind the concurrency-1 mutex.
  governor.reserve();
  try {
    const result = await governor.runExclusive(
      () => {
        governor.emit({
          ts: Date.now(), kind: "queued", caller, callee: spec.slug, depth: governor.depth,
        });
      },
      async () => {
        governor.emit({
          ts: Date.now(), kind: "started", caller, callee: spec.slug, depth: governor.depth,
        });
        const childGovernor = governor.childGovernor(spec.slug);
        const out = await runner({
          spec,
          question,
          depth: governor.depth + 1,
          childGovernor,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        });
        governor.emit({
          ts: Date.now(), kind: "completed", caller, callee: spec.slug, depth: governor.depth,
          detail: `${out.text.length} chars`,
        });
        return out;
      },
    );
    return { content: [{ type: "text", text: result.text }], details: {} };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    governor.emit({
      ts: Date.now(), kind: "failed", caller, callee: spec.slug, depth: governor.depth, reason: msg,
    });
    return { isError: true, content: [{ type: "text", text: `Delegation to '${spec.name}' failed: ${msg}` }], details: {} };
  }
}

/**
 * Build one callable-agent tool per allowed callee. Returns [] when this
 * governor is at the depth cap (so a callee never receives delegate tools).
 */
export function buildCallableAgentTools(
  specs: CallableAgentSpec[],
  governor: AgentDelegationGovernor,
  runner: NestedAgentRunner,
  opts: { signal?: AbortSignal; onProgress?: (label: string) => void } = {},
): CallableAgentTool[] {
  if (!governor.canExposeDelegationTools()) return [];
  if (!specs || specs.length === 0) return [];

  return specs.map((spec) => {
    const paramName = spec.paramName ?? "task";
    return {
      name: `ask_${spec.slug.replace(/[^a-zA-Z0-9_]/g, "_")}`,
      label: spec.name,
      description: callableAgentDescription(spec),
      progressLabels: spec.progressLabels ?? [`Delegating to ${spec.name}…`],
      parameters: paramSchema(spec),
      async execute(_toolCallId: string, params: unknown): Promise<ToolResultContent> {
        const question = String((params as Record<string, unknown>)?.[paramName] ?? "").trim();
        return runGovernedDelegation({ spec, question, governor, runner, opts });
      },
    };
  });
}

export function buildOrchestratorCallableAgentTool(
  specs: CallableAgentLightSpec[],
  governor: AgentDelegationGovernor,
  hydrateSpec: (calleeSlug: string) => Promise<CallableAgentSpec>,
  runner: NestedAgentRunner,
  opts: { signal?: AbortSignal; onProgress?: (label: string) => void } = {},
): CallableAgentTool[] {
  if (!governor.canExposeDelegationTools()) return [];
  if (!specs || specs.length === 0) return [];

  const bySlug = new Map(specs.map((spec) => [spec.slug, spec]));
  const available = specs.map((spec) => spec.slug).sort();
  return [{
    name: "call-agent",
    label: "Call Agent",
    description: "Delegate a self-contained task to another agent — ONE at a time, never batch; prefer using list_agents first to choose.",
    progressLabels: ["Delegating to agent…"],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["agentSlug", "task"],
      properties: {
        agentSlug: {
          type: "string",
          description: `Agent slug to call. Available slugs: ${available.join(", ")}`,
        },
        task: {
          type: "string",
          description: "The complete, self-contained task for the selected agent. Include all context it needs — it does not see this conversation.",
        },
      },
    },
    async execute(_toolCallId: string, params: unknown): Promise<ToolResultContent> {
      const raw = params as Record<string, unknown> | null | undefined;
      const agentSlug = String(raw?.["agentSlug"] ?? "").trim();
      const question = String(raw?.["task"] ?? "").trim();
      const light = bySlug.get(agentSlug);
      if (!light) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Unknown agentSlug '${agentSlug || "(empty)"}'. Available slugs: ${available.join(", ") || "(none)"}`,
          }],
          details: { availableSlugs: available },
        };
      }
      opts.onProgress?.(light.progressLabels?.[0] ?? `Delegating to ${light.name}…`);
      const fullSpec = await hydrateSpec(agentSlug);
      return runGovernedDelegation({ spec: fullSpec, question, governor, runner, opts });
    },
  }];
}
