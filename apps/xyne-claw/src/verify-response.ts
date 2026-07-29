/**
 * Pre-delivery response verifier for `verifyResponses` agents.
 *
 * Before a verified-response agent's final message reaches the user, this
 * checks the draft's concrete factual claims against the evidence the agent
 * actually gathered this run (tool results in the session transcript). It is
 * the single-run equivalent of the /goal audit pass (goalRelooper.ts): catch
 * confident-but-wrong output ("58 open PRs" when the tool returned 27) before
 * it's posted, not after.
 *
 * Design — why a tool-result channel, not a system nudge:
 *   An injected "[user] please verify" turn reads to the model as the user
 *   correcting it, so it apologizes and posts only the delta. A/B tested on
 *   our own model (kimi): user-injection apologized 12/20 and dropped content;
 *   a structured tool rejection apologized 0/20 and resubmitted complete. So
 *   the loop lives in agent.ts: the agent delivers via the `submit-response`
 *   tool, and a failed verdict comes back as that tool's result. This module
 *   only renders the verdict; agent.ts owns the loop + injection.
 *
 * Mirrors goal-judge.ts: forced tool-call returns a strict object, and ANY
 * failure (LLM down, parse error, timeout) fails OPEN to `{ ok: true }` so a
 * verifier outage never blocks a user's response.
 *
 * Model choice: uses LITELLM.model (the same model the agent runs on), NOT
 * fastModel — fastModel ("private-large") isn't on every team's allow-list,
 * and a 401 there silently fails the verifier open (no verification at all).
 * The main model is always accessible since the agent itself uses it.
 */
import { LITELLM } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("verify-response");

// Same rationale as the goal judge: LiteLLM can be slow under load and a
// timeout fails open, so wait it out rather than blocking delivery blind.
const VERIFY_TIMEOUT_MS = Number(process.env["RESPONSE_VERIFY_TIMEOUT_MS"] ?? 120_000);

// Caps so a giant transcript can't blow up the verifier's own context.
const EVIDENCE_MAX_CHARS = Number(process.env["RESPONSE_VERIFY_EVIDENCE_CHARS"] ?? 14_000);
const PER_RESULT_MAX_CHARS = 2_000;
const DRAFT_MAX_CHARS = 8_000;

export interface ResponseClaimError {
  /** The specific claim in the draft that failed (quote/paraphrase). */
  claim: string;
  /** What check was applied (e.g. "source recount", "metric value"). */
  check: string;
  /** What the evidence actually showed. */
  found: string;
}

export interface ResponseVerdict {
  ok: boolean;
  errors: ResponseClaimError[];
}

export interface VerifyResponseInput {
  /** The user's original request. */
  task: string;
  /** Capped digest of tool results gathered this run (see extractEvidenceDigest). */
  evidenceDigest: string;
  /** The draft the agent wants to deliver. */
  draft: string;
  /** Per-agent delivery criteria (agentConfig.verifyResponseCriteria), authored
   *  in the UI. Stacked ON TOP of the default factual check, with INVERTED
   *  semantics: for these, missing/absent evidence IS a failure (e.g. "must
   *  have posted a POT video"). Empty/undefined → default check only. */
  criteria?: string | undefined;
}

interface TranscriptMessage {
  role?: unknown;
  content?: unknown;
  toolName?: unknown;
  isError?: unknown;
}

/**
 * Pull tool-result text out of the pi session transcript into a bounded
 * digest the verifier can check claims against. Only tool results carry
 * external ground truth (search hits, API payloads, file reads); assistant
 * prose is the thing being verified, so it's deliberately excluded.
 *
 * Handles BOTH shapes that appear in `session.messages`:
 *   1. pi-native (the common case): a top-level message with
 *      `{ role: "toolResult", toolName, isError, content: [{type:"text",text}] }`.
 *      Verified against real session dumps — this is what pi actually stores.
 *   2. Anthropic wire format: `{ role: "user", content: [{ type: "tool_result",
 *      content: <string | block[]> }] }` — the shape repairDanglingToolUses in
 *      agent.ts injects to satisfy a dangling tool_use before a resume. Kept so
 *      those injected results aren't missed.
 *
 * Errored tool results are skipped: a failed call is not ground truth, and its
 * error text shouldn't be treated as a fact the draft must match.
 */
export function extractEvidenceDigest(
  messages: ReadonlyArray<TranscriptMessage> | undefined,
  maxChars: number = EVIDENCE_MAX_CHARS,
): string {
  if (!messages?.length) return "";
  const chunks: string[] = [];

  const push = (name: string | undefined, text: string) => {
    if (!text.trim()) return;
    const labelled = name ? `[${name}] ${text}` : text;
    chunks.push(labelled.slice(0, PER_RESULT_MAX_CHARS));
  };

  for (const msg of messages) {
    // Shape 1: pi-native toolResult message.
    if (msg.role === "toolResult") {
      if (msg.isError === true) continue;
      const name = typeof msg.toolName === "string" ? msg.toolName : undefined;
      push(name, toolResultText(msg.content));
      continue;
    }
    // Shape 2: Anthropic wire-format tool_result blocks inside a user message.
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (!block || block["type"] !== "tool_result") continue;
      if (block["is_error"] === true) continue;
      const name = typeof block["name"] === "string" ? (block["name"] as string) : undefined;
      push(name, toolResultText(block["content"]));
    }
  }

  if (chunks.length === 0) return "";
  // Keep the MOST RECENT results — later turns reflect the final state the
  // draft is describing (sliding window over the tail, same as goalRelooper).
  let out = chunks.join("\n---\n");
  if (out.length > maxChars) out = out.slice(-maxChars);
  return out;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        const rec = b as Record<string, unknown>;
        return typeof rec["text"] === "string" ? (rec["text"] as string) : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const SYSTEM_PROMPT = `You are a PRE-DELIVERY VERIFIER. An agent has drafted a response to a user. Before it is sent, you check whether the draft's CONCRETE, CHECKABLE claims are supported by the EVIDENCE the agent gathered (tool results).

## What to check
- Numeric claims: counts, totals, percentages, metric values, dates, IDs. These must match the evidence.
- Enumerations: "all N items", "the following X" — the list must be consistent with the evidence (right count, no fabricated entries).
- Direct factual assertions about the gathered data (status, names, outcomes).

## What NOT to flag
- Opinions, recommendations, framing, tone, formatting, style.
- Claims you cannot check against the provided evidence (missing evidence is NOT a failure — only flag when evidence CONTRADICTS the draft).
- Reasonable rounding or paraphrase that preserves meaning.
- Information the agent legitimately knows that isn't in tool results (general knowledge).

Be conservative: only report an error when the evidence clearly CONTRADICTS a specific claim. When in doubt, pass. A false rejection wastes a turn and annoys the user; only a clear contradiction is worth blocking on.

You MUST call the \`verdict\` tool. If everything checkable is consistent (or nothing is checkable), return ok=true with an empty errors array. Otherwise ok=false and one entry per contradicted claim (claim, check, found), max 5.`;

/**
 * Appended to the system prompt when the agent has per-agent delivery criteria.
 * Note the INVERTED rule vs the default check: for these requirements, ABSENCE
 * of supporting evidence IS a failure (the default rule "missing evidence is not
 * a failure" applies only to the factual checks above, NOT here).
 */
function criteriaAppendix(criteria: string): string {
  return `

## Agent-specific delivery requirements (MANDATORY)
The agent's owner requires ALL of the following to be satisfied before this draft may be delivered. These are REQUIREMENTS, not factual claims — so the rule above ("missing evidence is not a failure") does NOT apply here. If the draft does not satisfy a requirement, OR the evidence does not show the required action was actually taken, that IS a failure: return ok=false with one \`errors\` entry per unmet requirement (claim = the requirement, check = "delivery requirement", found = what's missing). Be strict: do not pass a requirement on the agent's say-so — the EVIDENCE must show it.

Requirements:
${criteria.trim()}`;
}

const VERDICT_TOOL = {
  type: "function" as const,
  function: {
    name: "verdict",
    description: "Return ok=true to deliver the draft, ok=false to send it back for correction.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
        errors: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              claim: { type: "string" },
              check: { type: "string" },
              found: { type: "string" },
            },
            required: ["claim", "check", "found"],
          },
        },
      },
      required: ["ok", "errors"],
    },
  },
};

export async function verifyResponse(input: VerifyResponseInput): Promise<ResponseVerdict> {
  // Fail open when the verifier can't run. The no-evidence fast-pass applies
  // ONLY to the default check (nothing to contradict). When per-agent criteria
  // are set, empty evidence means the requirements weren't shown to be met —
  // so we must still run the verifier rather than wave it through.
  if (!LITELLM.apiKey) return { ok: true, errors: [] };
  if (!input.evidenceDigest.trim() && !input.criteria?.trim()) return { ok: true, errors: [] };

  const systemPrompt = input.criteria?.trim()
    ? SYSTEM_PROMPT + criteriaAppendix(input.criteria)
    : SYSTEM_PROMPT;

  const userContent = [
    `User's original request:\n${input.task}`,
    "",
    "--- Evidence gathered this run (tool results, may be truncated) ---",
    input.evidenceDigest,
    "",
    "--- Draft response to verify ---",
    input.draft.slice(0, DRAFT_MAX_CHARS),
  ].join("\n");

  try {
    const res = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools: [VERDICT_TOOL],
        tool_choice: { type: "function", function: { name: VERDICT_TOOL.function.name } },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[verify-response] LiteLLM ${res.status}: ${body.slice(0, 200)} — failing open`);
      return { ok: true, errors: [] };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      log.warn("[verify-response] no tool_call in response — failing open");
      return { ok: true, errors: [] };
    }

    return parseVerdict(raw);
  } catch (err) {
    log.warn(`[verify-response] call failed: ${err instanceof Error ? err.message : String(err)} — failing open`);
    return { ok: true, errors: [] };
  }
}

/** Parse + normalize the model's verdict. Exported for unit testing. */
export function parseVerdict(raw: string): ResponseVerdict {
  let parsed: { ok?: unknown; errors?: unknown };
  try {
    parsed = JSON.parse(raw) as { ok?: unknown; errors?: unknown };
  } catch {
    return { ok: true, errors: [] }; // unparseable → fail open
  }

  const errors = Array.isArray(parsed.errors)
    ? (parsed.errors as Array<Record<string, unknown>>)
        .map((e) => ({
          claim: String(e?.["claim"] ?? "").slice(0, 300),
          check: String(e?.["check"] ?? "").slice(0, 200),
          found: String(e?.["found"] ?? "").slice(0, 300),
        }))
        .filter((e) => e.claim || e.found)
        .slice(0, 5)
    : [];

  // Only treat as a failure when ok===false AND there's at least one concrete
  // error. ok=false with no errors is ambiguous → deliver rather than loop.
  const ok = parsed.ok !== false || errors.length === 0;
  return { ok, errors: ok ? [] : errors };
}

/**
 * Render a verdict's errors into the structured tool-result text fed back to
 * the agent when its draft is rejected. Deliberately machine-shaped (a
 * delivery-status object) so the model retries like a schema failure instead
 * of apologizing — see module header.
 */
export function renderRejection(errors: ResponseClaimError[]): string {
  return JSON.stringify({
    delivered: false,
    errors,
    action:
      "Fix and resubmit the COMPLETE message via submit-response. Rejected drafts are never shown to the user; " +
      "the message must be self-contained and must not reference validation, drafts, or corrections.",
  });
}