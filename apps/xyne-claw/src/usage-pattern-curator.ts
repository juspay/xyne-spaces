import { createLogger } from "./logger.js";
const log = createLogger("usage-pattern-curator");

/**
 * UsagePatternCurator — synthesises a routing artifact describing what an agent
 * is ACTUALLY used for, from a window of its completed runs.
 *
 * Lives on claw because the LLM call (LiteLLM/Haiku-class) lives here. The
 * synthesizer on claw-auth selects runs, redacts them, posts them to
 * POST /internal/usage-pattern-curator/distill, then enforces its own
 * aggregation thresholds against the returned structured patterns before
 * persisting the markdown.
 *
 * Mirrors the FailureCurator pattern:
 *   - Forced tool-call with a strict JSON schema (guaranteed-valid output)
 *   - Strict system prompt that rejects instances in favour of shapes
 *   - Returns `ok: false` on any failure (LLM timeout, bad JSON, missing env), which
 *     the caller needs in order to tell a failed pass from an honestly empty one
 *
 * The caller has already stripped result bodies and tool arguments and redacted
 * identifier-shaped text. This module never sees them and must never ask for them.
 */

import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
// Background job: prefer the low-priority automation key so synthesis bursts
// can't queue interactive agent turns on the main key's parallel-slot pool.
const LITELLM_API_KEY = process.env["LITELLM_AUTOMATION_API_KEY"]?.trim() || (process.env["LITELLM_API_KEY"] ?? "");
// Model MUST be resolved from the same source as the key above: LiteLLM keys are
// team-scoped with DISJOINT allowed-model lists, so pairing the automation key
// with the interactive `LITELLM_MODEL` yields a hard 403 ("team not allowed to
// access model") — prod 2026-08-14. Reuse the pair, never mix them.
const CURATOR_MODEL = process.env["LITELLM_AUTOMATION_MODEL"]?.trim()
  || process.env["LITELLM_MODEL"]
  || "claude-haiku-4-5-20251001";
/**
 * Ten minutes, matching curator.ts and user-memory-curator.ts, which share this
 * key. That is not generosity: LITELLM_AUTOMATION_API_KEY is the LOW-PRIORITY
 * key by design (see above), so its requests queue behind interactive traffic
 * and the wait, not the generation, is what the clock is mostly measuring.
 *
 * At 90s this timed out on 10 of 10 attempts in production on 2026-09-18 while
 * its 600s siblings on the same key were fine, and every agent that cleared the
 * corpus thresholds came back `distill-failed`.
 */
const CURATOR_TIMEOUT_MS = Number(process.env["USAGE_PATTERN_CURATOR_TIMEOUT_MS"] ?? 600_000);

const MAX_SAMPLES = 80;
const MAX_CHARS_PER_TASK = 320;
const MAX_TOOLS_PER_SAMPLE = 10;
const MAX_TOOL_FREQUENCY_ROWS = 25;
const MAX_PATTERNS = 8;
const MAX_CAPABILITIES = 12;
const MAX_MARKDOWN_CHARS = 2_400;

const OUTCOMES = ["delivers", "fails", "mixed"] as const;
type Outcome = (typeof OUTCOMES)[number];

export interface UsagePattern {
  summary: string;
  /** Fraction of the sampled runs this shape covers, 0..1. */
  runShare: number;
  distinctUsers: number;
  outcome: Outcome;
}

export interface UsagePatternResult {
  /**
   * False when the curator could not produce an answer — LiteLLM refused, the
   * response carried no tool call, the arguments would not parse. The caller
   * must be able to tell that apart from a curator that ran and honestly found
   * nothing recurring: the first leaves yesterday's file alone, the second is a
   * publishable statement about the agent.
   */
  ok: boolean;
  patterns: UsagePattern[];
  capabilities: string[];
  markdown: string;
}

/** One run, already reduced and redacted by the caller. No result body, no tool args. */
export interface UsageSample {
  task: string;
  status: string;
  rating?: "up" | "down" | null;
  toolsUsed: string[];
  totalMs?: number | null;
}

export interface UsagePatternRequest {
  agentSlug: string;
  /** The agent's authored description — background only, never evidence. */
  agentDescription?: string;
  windowStart: string;
  windowEnd: string;
  runCount: number;
  distinctUsers: number;
  samples: UsageSample[];
  toolFrequency: Array<{ tool: string; count: number }>;
}

const FAILED: UsagePatternResult = { ok: false, patterns: [], capabilities: [], markdown: "" };
/** Nothing was asked of the model, so "nothing recurs" is the honest answer. */
const NOTHING_TO_DO: UsagePatternResult = { ok: true, patterns: [], capabilities: [], markdown: "" };

const EMIT_USAGE_PATTERNS_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_usage_patterns",
    description: "Emit the usage patterns observed across the sampled runs, plus the markdown file body built from them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        patterns: {
          type: "array",
          maxItems: MAX_PATTERNS,
          description: "The request SHAPES people bring to this agent. Empty array is valid when nothing recurs.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: {
                type: "string",
                description: "One sentence naming the SHAPE of the request, in the third person. Example: 'Users ask this agent to trace a failed transaction from an identifier to a root cause.' BAD: anything quoting an actual identifier, customer, repo, ticket or URL from a sample.",
              },
              runShare: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "Fraction of the sampled runs matching this shape, 0..1. Count the samples, do not estimate.",
              },
              distinctUsers: {
                type: "integer",
                minimum: 1,
                description: "How many distinct users' samples this shape covers. Samples are not labelled by user, so give your lower bound from the variety of phrasing; never exceed the distinctUsers figure in the input.",
              },
              outcome: {
                type: "string",
                enum: [...OUTCOMES],
                description: "delivers = matching samples completed and were not rated down; fails = they consistently failed or were rated down; mixed = both, materially.",
              },
            },
            required: ["summary", "runShare", "distinctUsers", "outcome"],
          },
        },
        capabilities: {
          type: "array",
          maxItems: MAX_CAPABILITIES,
          items: { type: "string" },
          description: "Tool names from the input's toolsUsed/toolFrequency, most-used first. Copy the names verbatim; never invent a tool that does not appear in the input.",
        },
        markdown: {
          type: "string",
          description: `The file body, at most ${MAX_MARKDOWN_CHARS} characters. Sections in this order: '## What people bring here' (one bullet per pattern, with ~X% of runs and N users), '## Capabilities actually exercised', and '## Where it does not deliver' — the last one ONLY when failed or down-rated samples support it. Descriptive, never instructional.`,
        },
      },
      required: ["patterns", "capabilities", "markdown"],
    },
  },
};

const SYSTEM_PROMPT = `You are the UsagePatternCurator. You read a window of an AI agent's runs and write the short file that tells an orchestrator WHAT THIS AGENT IS ACTUALLY USED FOR, and where it falls down.

Your output is read by two audiences: a routing orchestrator deciding whether to delegate work here, and the human who owns the agent. Both are served by the same thing — an honest, observed description. A brochure is worse than nothing, because it routes work to an agent that will fail it.

# Shapes, never instances

Every run you are shown came from a real user. The file is shared across the whole org, so ANY surviving specific is a leak from one user to everyone.

- GOOD: "Users ask this agent to trace a failed transaction from an identifier to a root cause."
- LEAK: any actual identifier, order number, merchant, customer, person's name, email, repo, branch, ticket key, URL, hostname, or hex/UUID string — even if it appears in many samples.
- LEAK: quoting a sample task verbatim. Paraphrase into the general shape.

If a shape cannot be stated without a specific, drop the shape.

# Ground everything in the samples

- Never invent a request type, a tool, a capability or a failure mode that is not visible in the input.
- Never infer from the agent's description what people use it for. The description is what its author CLAIMED; the samples are what actually happens. Where they disagree, the samples win and the description is ignored.
- \`capabilities\` are copied from the input's tool names, verbatim. No paraphrasing into prose capability names, no additions.
- Do not estimate percentages. Count matching samples and divide by the number of samples given.

# A pattern is a recurrence

One run is an incident, not a pattern. Emit a shape only when several samples share it. Emitting 2 well-grounded shapes from 80 samples is a better answer than 8 thin ones. An empty patterns array is a valid response.

# "Where it does not deliver"

This section is the reason the file exists — it is what turns it into a routing artifact rather than a brochure.

- It must be grounded in samples with status failed/cancelled or rating "down". Nothing else counts as evidence of not delivering. Slow-but-completed is not a failure; a completed run with no rating is not a failure.
- If there are no such samples, OMIT THE SECTION ENTIRELY. Do not write "no notable failures", do not soften a success into a caveat, do not pad. Its absence is meaningful.
- Keep it factual and descriptive ("requests of shape X fail more often than they complete"), never instructional ("do not send X here").

# The markdown

- At most ${MAX_MARKDOWN_CHARS} characters; aim for around 2000. It is loaded into prompts — every character is paid for on every turn.
- Sections, in order: "## What people bring here", "## Capabilities actually exercised", then "## Where it does not deliver" if and only if the evidence exists.
- Bullets under "What people bring here" carry the numbers: \`- <shape> (~X% of runs, N users)\`.
- No preamble, no conclusion, no praise, no recommendations. Do not restate the agent's description.
- The markdown must agree with the structured patterns you emit — same shapes, same numbers. The caller re-checks the numbers against its own counts and drops patterns that fail its thresholds.

Call emit_usage_patterns with your result. The tool schema enforces the shape.`;

function renderSample(s: UsageSample, index: number): string {
  const bits = [`status=${s.status}`];
  if (s.rating) bits.push(`rating=${s.rating}`);
  if (typeof s.totalMs === "number") bits.push(`${(s.totalMs / 1_000).toFixed(1)}s`);
  const tools = s.toolsUsed.slice(0, MAX_TOOLS_PER_SAMPLE);
  if (tools.length > 0) {
    bits.push(`tools=[${tools.join(", ")}${s.toolsUsed.length > tools.length ? `, +${s.toolsUsed.length - tools.length}` : ""}]`);
  }
  return `[${index + 1}] ${bits.join(" ")}\n  task: ${s.task.slice(0, MAX_CHARS_PER_TASK)}`;
}

function buildUserPrompt(req: UsagePatternRequest, samples: UsageSample[]): string {
  const lines: string[] = [
    `Agent: ${req.agentSlug}`,
    `Window: ${req.windowStart} .. ${req.windowEnd}`,
    `Runs in window: ${req.runCount} by ${req.distinctUsers} distinct users`,
    `Samples below: ${samples.length} (runShare is a fraction of these ${samples.length}, not of ${req.runCount})`,
    "",
  ];
  if (req.agentDescription) {
    lines.push("## Agent's authored description (background only — NOT evidence of usage)");
    lines.push(req.agentDescription.slice(0, 1_500));
    lines.push("");
  }
  if (req.toolFrequency.length > 0) {
    lines.push("## Tool usage across the whole window (source for `capabilities`)");
    for (const t of req.toolFrequency.slice(0, MAX_TOOL_FREQUENCY_ROWS)) {
      lines.push(`- ${t.tool}: ${t.count}`);
    }
    lines.push("");
  }
  lines.push("## Samples (already redacted; tasks only, no result bodies, no tool arguments)");
  for (const [i, s] of samples.entries()) {
    lines.push(renderSample(s, i));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Synthesise usage patterns for a single agent. Returns the validated result,
 * or `ok: false` on any failure (LLM down, bad JSON, missing env). Never throws.
 */
export async function curateUsagePatterns(req: UsagePatternRequest): Promise<UsagePatternResult> {
  if (!Array.isArray(req.samples) || req.samples.length === 0) return NOTHING_TO_DO;
  if (!LITELLM_API_KEY) {
    log.warn("[usage-pattern-curator] LITELLM_API_KEY not set — skipping");
    return FAILED;
  }

  const samples = req.samples.slice(0, MAX_SAMPLES);

  try {
    const res = await fetchLiteLLMWithRetry(`${LITELLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LITELLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: CURATOR_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: buildUserPrompt(req, samples) },
        ],
        tools: [EMIT_USAGE_PATTERNS_TOOL],
        tool_choice: { type: "function", function: { name: "emit_usage_patterns" } },
        temperature: 0.2,
      }),
      // Single shot. The default 3 retries are 5s/15s/45s apart with the timeout
      // applied PER ATTEMPT, so a failing call kept hammering LiteLLM for ~7
      // minutes after claw-auth had already hung up — orphaned load that showed
      // up as the 429s at the tail of that incident. Retrying belongs to the
      // BullMQ job, which survives a pod restart and holds no LLM slot while it
      // waits; here it only burns quota nobody is waiting on.
    }, { timeoutMs: CURATOR_TIMEOUT_MS, label: "usage-pattern-curator", maxRetries: 0 });
    if (!res.ok) {
      log.warn(`[usage-pattern-curator] LiteLLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return FAILED;
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      log.warn("[usage-pattern-curator] no tool_call in response");
      return FAILED;
    }
    const parsed = JSON.parse(args) as { patterns?: unknown; capabilities?: unknown; markdown?: unknown };

    const markdown = typeof parsed.markdown === "string" ? parsed.markdown.trim().slice(0, MAX_MARKDOWN_CHARS) : "";
    if (markdown.length === 0) {
      log.warn("[usage-pattern-curator] empty markdown — discarding");
      return FAILED;
    }

    const patterns = Array.isArray(parsed.patterns)
      ? parsed.patterns
          .map((p) => normalisePattern(p, req.distinctUsers))
          .filter((p): p is UsagePattern => p !== null)
          .slice(0, MAX_PATTERNS)
      : [];

    const knownTools = new Set(req.toolFrequency.map((t) => t.tool).concat(...samples.map((s) => s.toolsUsed)));
    const capabilities = Array.isArray(parsed.capabilities)
      ? [...new Set(parsed.capabilities.filter((c): c is string => typeof c === "string" && knownTools.has(c)))].slice(0, MAX_CAPABILITIES)
      : [];

    return { ok: true, patterns, capabilities, markdown };
  } catch (err) {
    log.warn("[usage-pattern-curator] failed:", err instanceof Error ? err.message : String(err));
    return FAILED;
  }
}

function normalisePattern(p: unknown, maxDistinctUsers: number): UsagePattern | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const summary = typeof o["summary"] === "string" ? o["summary"].trim() : "";
  if (summary.length < 12) return null;
  const runShare = typeof o["runShare"] === "number" && Number.isFinite(o["runShare"]) ? o["runShare"] : null;
  if (runShare === null) return null;
  const distinctUsers = typeof o["distinctUsers"] === "number" && Number.isFinite(o["distinctUsers"]) ? Math.floor(o["distinctUsers"]) : null;
  if (distinctUsers === null || distinctUsers < 1) return null;
  const outcome = o["outcome"];
  if (!OUTCOMES.includes(outcome as Outcome)) return null;
  return {
    summary,
    runShare: Math.min(1, Math.max(0, runShare)),
    // The model cannot see user labels, so its count is a guess — clamp it to the
    // caller's true figure, which is what the thresholds are enforced against.
    distinctUsers: Math.min(distinctUsers, Math.max(1, maxDistinctUsers)),
    outcome: outcome as Outcome,
  };
}
