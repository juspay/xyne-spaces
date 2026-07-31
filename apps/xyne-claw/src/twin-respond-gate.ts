/**
 * Digital Twin respond/ignore gate (Memory v2, gap-2 fix).
 *
 * COARSE PRE-FILTER deciding whether to even RUN the Twin on an incoming
 * @mention — NOT the final say. Runs on claw (LLM), called S2S by claw-auth's
 * webhook before it dispatches a twin run. It only skips obvious noise; anything
 * plausible is let through, because there are TWO stronger checks downstream: the
 * Twin then gathers the full thread + context and makes its OWN, better-informed
 * call (it can choose `ignore`), and the user still approves/declines any drafted
 * reply before it posts. So this gate leans PERMISSIVE — a false "let it through"
 * costs one wasted run, while a false "skip" silently drops a real mention.
 * Only INFRA errors fail-closed (skip): an unavailable gate must not fire a twin
 * run on every mention.
 */

import { fetchLiteLLMWithRetry } from "./litellm-retry.js";
import { createLogger } from "./logger.js";

const log = createLogger("twin-respond-gate");

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
const LITELLM_API_KEY = process.env["LITELLM_API_KEY"] ?? "";
// Model for the gate. Defaults to LITELLM_MODEL (the platform default the rest of
// the twin uses) for consistency, then haiku as a last resort. The gate's latency
// is dominated by the shared gateway's slow decode (~10-14 tok/s), NOT the model
// choice, so inheriting LITELLM_MODEL is fine — the big timeout below absorbs the
// slow tail. Set TWIN_RESPOND_GATE_MODEL to pin a different (e.g. faster) model.
const GATE_MODEL = process.env["TWIN_RESPOND_GATE_MODEL"] ?? process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";
// Per-attempt LLM budget. Set high (4 min) on purpose: the shared LiteLLM
// gateway decodes SLOWLY (~10-14 tok/s measured), and this gate's decision —
// {respond, confidence, reason} — can run ~150-200 output tokens, so a single
// call legitimately takes ~6-20s and, under gateway load, longer. A tight
// timeout here was fail-closing the twin to silence on the slow tail even though
// the call would have succeeded. This is a CEILING, not the norm: healthy calls
// still return in seconds; the big budget only rescues the slow tail. MUST stay
// below the claw-auth client's TWIN_RESPOND_GATE_CLIENT_TIMEOUT_MS so claw
// returns a clean, traced fail-closed instead of the client aborting the HTTP
// call. With maxRetries:0 below, this is a hard single-attempt ceiling.
const GATE_TIMEOUT_MS = Number(process.env["TWIN_RESPOND_GATE_TIMEOUT_MS"] ?? 240_000);

export interface RespondGateRequest {
  incoming: string;
  channelName?: string;
  channelType?: string;
  senderName?: string;
  /** The user's response/ignore memory texts (recalled by claw-auth). */
  patterns: string[];
  /** Memories semantically related to THIS message — what the user knows about
   *  the topic / project / people involved. Strong "would they care" signal. */
  relevantContext?: string[];
  /** Human-readable behavioural stats summary. */
  stats?: string;
  /** True when this is a direct 1:1 DM to the user. */
  isDirectMessage?: boolean;
  /** True when the user has already authored a message in this conversation. */
  isThreadParticipant?: boolean;
  /** When true, decideRespond returns the full LLM exchange for the pipeline UI. */
  includeTrace?: boolean;
}

/** Full LLM exchange of one gate decision — surfaced in the pipeline activity UI. */
export interface RespondGateTrace {
  systemPrompt: string;
  userPrompt: string;
  /** The model's raw decision output (tool-call arguments JSON). */
  response: string;
  /** The model's reasoning, if it emitted any alongside the forced tool call. */
  thinking?: string;
  model: string;
  finishReason?: string;
}

export interface RespondGateResult {
  respond: boolean;
  confidence: number; // 0-1
  reason: string;
  /** How the decision was reached — for observability. */
  source: "llm" | "fail-closed" | "no-patterns";
  /** Present only when the request set includeTrace and the LLM actually ran. */
  trace?: RespondGateTrace;
}

const DECISION_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_decision",
    description: "Emit the respond/ignore decision for the Twin.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        respond: { type: "boolean", description: "true = let the Twin handle this mention (it reads full context and decides to reply OR stay silent); false = skip it now as clear noise." },
        confidence: { type: "number", minimum: 0, maximum: 1, description: "0-1 certainty of the decision." },
        reason: { type: "string", description: "One short line explaining the decision." },
      },
      required: ["respond", "confidence", "reason"],
    },
  },
};

const SYSTEM_PROMPT = `You are a COARSE PRE-FILTER for a user's Digital Twin — an AI that drafts replies to @mentions AS the user. Your ONLY job is to skip obvious NOISE so the Twin doesn't waste a run on it. You are NOT the final decision.

Crucially: when you let a mention through, the Twin then reads the full thread and the user's context and makes its OWN, better-informed call — it can still choose to stay silent, and even if it drafts a reply, the user approves or declines it before anything is posted. So letting a borderline mention through is CHEAP and SAFE (at worst one wasted run), while wrongly skipping one silently drops a real message. Lean toward letting things through.

You are given: the user's general response/ignore patterns, what the user KNOWS that is relevant to THIS message (their projects / people / expertise), and behavioural stats.

Rules:
- LEAN TOWARD respond=true. When the evidence is weak, mixed, absent, or you're unsure → respond=true and let the Twin decide with full context. Reserve respond=false for CLEAR noise.
- respond=false (skip) ONLY on clear noise: automated / bot pings; broad @channel or @here FYIs with no personal relevance; announcement-only channels the user never engages in; a topic the user has zero involvement in; OR a sender/channel the stats show the user overwhelmingly ignores AND nothing in THIS message is relevant to what they work on.
- respond=true on any real engagement signal: a direct 1:1 DM; a thread the user is already active in; a direct question / review / ask addressed to them; a message about a project / person / area they work on (see relevant-context); or simply a normal human message directed at them that isn't clearly noise. (See the flags in the message.)
- Do NOT over-index on "they ignored similar messages before." A history of ignoring is a MILD signal, not a veto — the Twin's own downstream check handles that nuance. Only let it push you to skip when the message is ALSO clearly low-value noise.
- confidence is 0-1: how sure you are of the decision. It's fine to be low-confidence — a low-confidence respond=true just means "let the Twin take a look."

Call emit_decision.`;

function buildUserPrompt(req: RespondGateRequest): string {
  const flags: string[] = [];
  if (req.isDirectMessage) flags.push("DIRECT 1:1 DM to the user");
  if (req.isThreadParticipant) flags.push("the user is ALREADY ACTIVE in this conversation");
  const lines = [
    "Incoming @mention:",
    `Channel: ${req.channelName ? `#${req.channelName}` : "(unknown)"}${req.channelType ? ` (${req.channelType})` : ""}`,
    `From: ${req.senderName ?? "someone"}`,
    ...(flags.length ? [`Flags: ${flags.join("; ")}`] : []),
    `Message: "${req.incoming.slice(0, 1500)}"`,
    "",
    "The user's learned response / ignore patterns:",
    ...(req.patterns.length ? req.patterns.map((p) => `- ${p.slice(0, 400)}`) : ["- (none captured yet)"]),
  ];
  if (req.relevantContext?.length) {
    lines.push(
      "",
      "What the user knows relevant to THIS message (their projects / people / expertise):",
      ...req.relevantContext.map((p) => `- ${p.slice(0, 400)}`),
    );
  }
  if (req.stats) lines.push("", `Behavioural stats: ${req.stats}`);
  lines.push("", "Should the Twin reply as the user?");
  return lines.join("\n");
}

/** Extract the decision arg object from a model response — tolerant of models
 *  that don't honour forced tool_choice. Handles: proper JSON (tool_call
 *  arguments), JSON leaked into content (bare / fenced / prose-wrapped), AND
 *  GLM native tool-call markup that LiteLLM failed to normalize into tool_calls,
 *  which arrives as `<arg_key>K</arg_key><arg_value>V</arg_value>` pairs (the
 *  same intermittent glm leak the curator handles). Returns the raw arg object
 *  (values may be strings) whenever a `respond` field is present, else null. */
function extractDecisionObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  // 1) Whole string as JSON, then the first `{…}` block (fences / prose wrappers).
  const direct = tryParse(raw.trim());
  if (direct && "respond" in direct) return direct;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    const p = tryParse(m[0]);
    if (p && "respond" in p) return p;
  }
  // 2) GLM native tool-call markup leaked into content: pull each
  //    <arg_key>K</arg_key><arg_value>V</arg_value> pair (non-greedy).
  const pairRe = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  const out: Record<string, unknown> = {};
  let mm: RegExpExecArray | null;
  while ((mm = pairRe.exec(raw)) !== null) {
    const key = mm[1]?.trim();
    if (key) out[key] = mm[2]?.trim();
  }
  if ("respond" in out) return out;
  return null;
}

/** Coerce the `respond` field to a strict boolean — booleans and the string
 *  forms GLM markup produces ("true"/"false", yes/no, 1/0). Null when unusable. */
function coerceRespond(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
  }
  return null;
}

/** Coerce `confidence` (number or numeric string) to a clamped 0-1; 0.5 fallback. */
function coerceConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/** Parse + normalize a gate decision from a raw model response (tool-call args
 *  or leaked content, JSON or GLM markup). Returns null when no usable decision
 *  is present. Exported for unit tests. */
export function parseGateDecision(raw: unknown): { respond: boolean; confidence: number; reason: string } | null {
  const obj = extractDecisionObject(raw);
  if (!obj) return null;
  const respond = coerceRespond(obj["respond"]);
  if (respond === null) return null;
  const reason = typeof obj["reason"] === "string" ? obj["reason"].slice(0, 300) : "";
  return { respond, confidence: coerceConfidence(obj["confidence"]), reason };
}

export async function decideRespond(req: RespondGateRequest): Promise<RespondGateResult> {
  const FAIL_CLOSED: RespondGateResult = { respond: false, confidence: 0, reason: "gate unavailable — staying silent", source: "fail-closed" };
  if (!LITELLM_API_KEY) return FAIL_CLOSED;
  // No short-circuit on missing patterns — EVERY mention goes through the LLM.
  // With no patterns to judge on, the permissive prompt leans respond=true and
  // lets the Twin take a look (it decides with full context downstream).

  const userPrompt = buildUserPrompt(req);
  try {
    const res = await fetchLiteLLMWithRetry(
      `${LITELLM_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${LITELLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GATE_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          tools: [DECISION_TOOL],
          tool_choice: { type: "function", function: { name: DECISION_TOOL.function.name } },
          temperature: 0,
        }),
      },
      // maxRetries:0 — this is a COARSE pre-filter, NOT the offline curator.
      // fetchLiteLLMWithRetry's default (3 retries, 5s/15s/45s backoff, retrying
      // even on a timeout) would STACK on top of the already-large single-attempt
      // budget above (4min × attempts = 12min+) and blow the client's budget.
      // One long attempt is the right shape here: the LLM call is slow but almost
      // always eventually succeeds; on genuine failure we fail-closed cleanly, and
      // the twin's own downstream ignore-gate + human approval still protect
      // correctness. Saturation (429) is rare with the fast default model.
      { timeoutMs: GATE_TIMEOUT_MS, label: "twin-respond-gate", maxRetries: 0 },
    );
    if (!res.ok) return FAIL_CLOSED;
    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const raw = msg?.tool_calls?.[0]?.function?.arguments ?? msg?.content ?? "";
    const thinking = (msg?.reasoning_content || (msg?.tool_calls?.length ? msg?.content : "")) || undefined;
    const trace: RespondGateTrace | undefined = req.includeTrace
      ? {
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          response: typeof raw === "string" ? raw : String(raw),
          ...(thinking ? { thinking } : {}),
          model: GATE_MODEL,
          ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        }
      : undefined;
    // glm models (e.g. glm-flash-experimental / glm-latest) do NOT reliably
    // honour forced tool_choice — they often return no tool_call and leak the
    // decision into `content`, either as JSON (fenced / prose-wrapped) OR as
    // native <arg_key>…</arg_key><arg_value>…</arg_value> markup. parseGateDecision
    // recovers all of these and coerces string values, instead of letting a valid
    // respond=true collapse to fail-closed. Keep the trace on failure so the
    // pipeline UI shows what the model actually returned (debuggability).
    const decision = parseGateDecision(raw);
    if (!decision) {
      log.warn(`[twin-respond-gate] no usable decision from ${GATE_MODEL} (rawLen=${raw.length}) — fail-closed`);
      return { ...FAIL_CLOSED, ...(trace ? { trace } : {}) };
    }
    return { ...decision, source: "llm", ...(trace ? { trace } : {}) };
  } catch (err) {
    log.warn(`[twin-respond-gate] failed — fail-closed: ${err instanceof Error ? err.message : String(err)}`);
    return FAIL_CLOSED;
  }
}
