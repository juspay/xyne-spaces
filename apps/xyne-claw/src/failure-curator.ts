import { createLogger } from "./logger.js";
const log = createLogger("failure-curator");

/**
 * FailureCurator — analyses recent negative sessions for a single agent and
 * proposes concrete improvements with cited evidence.
 *
 * Lives on claw because the LLM call (LiteLLM/Haiku-class) lives here. The
 * orchestrator on claw-auth selects negative-bucket sessions, posts them to
 * POST /internal/failure-curator/distill, persists the returned candidates
 * with dedupe.
 *
 * Mirrors the user-memory-curator pattern:
 *   - Forced tool-call with a strict JSON schema (guaranteed-valid output)
 *   - Strict system prompt that REJECTS vague advice
 *   - Returns [] on any failure (LLM timeout, bad JSON, missing env)
 *
 * Buckets (user-side symptoms) are fixed enums. Root causes (actionable
 * diagnoses) are also fixed. Together they tell the operator: "users felt
 * X; the underlying cause is Y; here is the fix Z."
 */

import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
// Background job: prefer the low-priority automation key so curator bursts
// can't queue interactive agent turns on the main key's parallel-slot pool.
const LITELLM_API_KEY = process.env["LITELLM_AUTOMATION_API_KEY"]?.trim() || (process.env["LITELLM_API_KEY"] ?? "");
// Model MUST be resolved from the same source as the key above: LiteLLM keys are
// team-scoped and the teams' allowed-model lists are DISJOINT, so pairing the
// automation key with the interactive `LITELLM_MODEL` yields a hard 403
// ("team not allowed to access model") — prod 2026-08-14, where the automation
// team allowed `private-large` but not `private-large-spaces`. Mirrors the
// key fallback: automation first, interactive second, code default last.
const CURATOR_MODEL = process.env["LITELLM_AUTOMATION_MODEL"]?.trim()
  || process.env["LITELLM_MODEL"]
  || "claude-haiku-4-5-20251001";
const CURATOR_TIMEOUT_MS = Number(process.env["FAILURE_CURATOR_TIMEOUT_MS"] ?? 90_000);

const MAX_NEGATIVE_SESSIONS = 30;
const MAX_CONTEXT_SESSIONS = 15;
const MAX_CHARS_PER_SESSION = 1_800;
const MAX_CANDIDATES_PER_BATCH = 8;

const BUCKETS = ["agent_unable_to_do_work", "failure", "user_frustrated"] as const;
type Bucket = (typeof BUCKETS)[number];

const ROOT_CAUSES = [
  "need-memory",
  "missing-tool",
  "prompt-ambiguity",
  "wrong-subagent",
  "redundant-subagent-call",
  "tool-misuse",
  "ext-api-failure",
  "permission-denied",
  "memory-miss",
  "identity-bleed",
  "no-actionable",
] as const;
type RootCause = (typeof ROOT_CAUSES)[number];

const FIX_TYPES = [
  "prompt-edit",
  "add-memory",
  "add-tool",
  "remove-tool",
  "tighten-subagent",
  "investigate",
  "ops",
] as const;
type FixType = (typeof FIX_TYPES)[number];

const CONFIDENCE = ["high", "medium", "low"] as const;
type Confidence = (typeof CONFIDENCE)[number];

export interface ImprovementCandidate {
  bucket: Bucket;
  rootCause: RootCause;
  finding: string;
  evidence: string[];
  proposedFix: { type: FixType; description: string };
  confidence: Confidence;
}

/** Input session payload sent by the orchestrator. Trimmed before prompting. */
export interface CuratorSession {
  sessionId: string;
  bucket?: Bucket;
  completedAt: string;
  status: string;
  task: string;
  result: string | null;
  error: string | null;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  llmRetries: number | null;
  lastRetryReason: string | null;
  /** Trimmed array of {toolName, durationMs, isError} per call. */
  toolInvocations?: Array<{ toolName: string; durationMs?: number; isError?: boolean }>;
  /** Only for user_frustrated sessions — the angry follow-up text. */
  frustrationFollowup?: string | null;
}

export interface CuratorRequest {
  agentSlug: string;
  /** The agent's current system prompt — lets the curator propose
   *  prompt-edit fixes that don't repeat existing rules. */
  systemPrompt?: string;
  /** Negative sessions detected since the last curator pass — primary
   *  evidence pool. Candidates MUST cite ≥2 of these as evidence. */
  newNegatives: CuratorSession[];
  /** Optional broader context — recent sessions over a 7d window so the
   *  curator can spot patterns even when newNegatives is small. NOT used
   *  as evidence. */
  contextWindow?: CuratorSession[];
}

const EMIT_CANDIDATES_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_improvement_candidates",
    description: "Emit improvement candidates for the agent, drawn from the negative sessions provided.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidates: {
          type: "array",
          maxItems: MAX_CANDIDATES_PER_BATCH,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              bucket: {
                type: "string",
                enum: [...BUCKETS],
                description: "User-side symptom. agent_unable_to_do_work = soft refusal / low-effort completion; failure = explicit fail/cancel/retries; user_frustrated = user expressed anger in a follow-up.",
              },
              rootCause: {
                type: "string",
                enum: [...ROOT_CAUSES],
                description: "Actionable diagnosis. Pick from the constrained list; never invent. no-actionable is allowed when you looked but nothing systemic.",
              },
              finding: {
                type: "string",
                description: "1-2 concrete sentences. Reference specific behaviour and the sessionIds. Example: 'ask-ai re-asks the spaces subagent 3-4 times in the same session with overlapping HDFC migration queries.' BAD: 'the agent could be improved'.",
              },
              evidence: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 12,
                description: "sessionIds from newNegatives that ground this finding. ≥2 required; if you only have 1, skip the candidate.",
              },
              proposedFix: {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: { type: "string", enum: [...FIX_TYPES] },
                  description: {
                    type: "string",
                    description: "Imperative, mechanical. For prompt-edit: a paste-able paragraph or bullet to add. For add-memory: the exact fact to store. For add-tool/remove-tool: the specific tool name. For tighten-subagent: which subagent and what scope.",
                  },
                },
                required: ["type", "description"],
              },
              confidence: {
                type: "string",
                enum: [...CONFIDENCE],
                description: "high = pattern across 4+ sessions with consistent root cause; medium = 2-3 sessions; low = inferred from 2 sessions where the connection is plausible.",
              },
            },
            required: ["bucket", "rootCause", "finding", "evidence", "proposedFix", "confidence"],
          },
        },
      },
      required: ["candidates"],
    },
  },
};

const SYSTEM_PROMPT = `You are the FailureCurator. You analyse recent NEGATIVE sessions of a single AI agent and propose CONCRETE, EVIDENCED improvements.

Your output is read by the agent's operator (a human engineer). They will Apply or Dismiss each candidate. Vague advice ("improve quality", "be more helpful") wastes their time; PASTE-ABLE advice with cited sessionIds is what matters.

# The bar for "concrete"

A finding is concrete when:
- It names a SPECIFIC behaviour you observed in the evidence sessions (e.g. "the parent calls the spaces subagent 3-4 times with overlapping queries about HDFC migration")
- It identifies a SPECIFIC actionable root cause from the constrained list
- The proposedFix is something an operator could apply in 1-2 minutes (paste this paragraph, add this tool, store this fact)

ABSTRACT findings like "the agent struggles with complex queries", "responses could be clearer", "more context would help" are ALL rejected. They tell the operator nothing.

# Buckets — pick by USER-SIDE symptom

- **agent_unable_to_do_work**: the result text contains soft refusals ("I couldn't…", "you may want to…") OR the run completed with no tools tried in under 15 seconds. The user gave up silently.
- **failure**: explicit failure — status='failed'/'cancelled', llmRetries > 0, or lastRetryReason populated.
- **user_frustrated**: the session has a frustrationFollowup field — the user typed something angry/dismissive in the same conversation within 10 minutes.

A single session may appear under multiple buckets in the input — pick the PRIMARY bucket per candidate (the one that captures the user's experience most strongly).

# Root causes — pick by WHAT TO CHANGE

- **need-memory**: a STABLE fact about this user/agent/workspace, if stored, would have changed the outcome. Examples: which connector a merchant uses, who owns a repo, what team a person is on. Not for facts the agent should LOOK UP each time (use missing-tool / wrong-subagent for that).
- **missing-tool**: agent literally had no tool available for what was asked.
- **prompt-ambiguity**: system prompt doesn't cover this scenario; agent guessed.
- **wrong-subagent**: routed to a subagent that couldn't answer; another subagent or direct tool would.
- **redundant-subagent-call**: looped or re-asked subagent with refined queries; a single well-scoped call would suffice.
- **tool-misuse**: called the right tool with wrong args, or picked a worse tool when a better one was available.
- **ext-api-failure**: upstream API (Bitbucket, Spaces, Grafana, etc.) failed — show the operator the error so they investigate the integration.
- **permission-denied**: the bot doesn't have channel/repo/etc. access. Fix is ops.
- **memory-miss**: memory-search ran and returned nothing — probably just out-of-scope; only flag if there's a pattern.
- **identity-bleed**: agent adopted another agent's voice or identity (especially for Twin/persona agents).
- **no-actionable**: you looked at the sessions but couldn't find a systemic fix.

# proposedFix types

- **prompt-edit**: write a paste-able block (1-3 sentences) the operator can add to systemPrompt. Quote the section header to insert under if you can infer it.
- **add-memory**: write the exact fact to retain, in third person + present tense. Bank "user" for facts about a specific user; bank "agent" for facts shared workspace-wide.
- **add-tool** / **remove-tool**: name the exact MCP server type or tool name.
- **tighten-subagent**: name the subagent and the specific rule to add to its inner prompt.
- **investigate**: a logged event the operator should look at; for ext-api-failure or unusual patterns.
- **ops**: a one-line action like "invite @<agent-bot> to #channel-name".

# Hard rules

1. **Every candidate cites ≥2 sessionIds from newNegatives**. If you only see ONE example, do NOT emit — wait for the pattern.
2. **One root cause per candidate.** Never bundle "missing-tool AND prompt-ambiguity" — split into two candidates if both apply.
3. **No speculation.** If sessions are ambiguous, skip them.
4. **The agent's current systemPrompt is in the input.** Don't propose a prompt-edit that's already there.
5. **For confidence**: high = 4+ matching sessions; medium = 2-3 matching; low = exactly 2 with plausible but not certain root cause.
6. **Output volume**: 0 candidates is a valid response. A batch of 30 negatives might emit 2 high-signal candidates; don't manufacture findings to hit a count. The MAX is 8 per batch.

Call emit_improvement_candidates with your result. The tool schema enforces the shape.`;

function trimSession(s: CuratorSession): string {
  const lines: string[] = [
    `[${s.sessionId}] bucket=${s.bucket ?? "?"} status=${s.status} totalMs=${s.totalMs ?? "?"}`,
  ];
  if (s.llmRetries && s.llmRetries > 0) lines.push(`  llmRetries=${s.llmRetries}${s.lastRetryReason ? ` reason="${s.lastRetryReason}"` : ""}`);
  if (s.frustrationFollowup)            lines.push(`  user_follow_up="${s.frustrationFollowup.slice(0, 300)}"`);
  lines.push(`  task: ${s.task.slice(0, 400)}`);
  if (s.result) lines.push(`  result: ${s.result.slice(0, MAX_CHARS_PER_SESSION)}`);
  if (s.error)  lines.push(`  error:  ${s.error.slice(0, 400)}`);
  if (s.toolInvocations && s.toolInvocations.length > 0) {
    const summary = s.toolInvocations
      .slice(0, 8)
      .map((t) => `${t.toolName}${typeof t.durationMs === "number" ? `(${Math.round(t.durationMs)}ms)` : ""}${t.isError ? "!" : ""}`)
      .join(", ");
    lines.push(`  tools: ${summary}${s.toolInvocations.length > 8 ? ` +${s.toolInvocations.length - 8} more` : ""}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(req: CuratorRequest): string {
  const lines: string[] = [
    `Agent: ${req.agentSlug}`,
    `New negative sessions to analyse: ${Math.min(req.newNegatives.length, MAX_NEGATIVE_SESSIONS)}`,
    "",
  ];
  if (req.systemPrompt) {
    lines.push("## Agent's current systemPrompt (don't propose edits already present)");
    lines.push(req.systemPrompt.slice(0, 4_000));
    lines.push("");
  }
  lines.push("## newNegatives (evidence — cite these sessionIds)");
  for (const s of req.newNegatives.slice(0, MAX_NEGATIVE_SESSIONS)) {
    lines.push(trimSession(s));
    lines.push("");
  }
  if (req.contextWindow && req.contextWindow.length > 0) {
    lines.push("## contextWindow (background only, NOT evidence)");
    for (const s of req.contextWindow.slice(0, MAX_CONTEXT_SESSIONS)) {
      lines.push(`[${s.sessionId}] status=${s.status} totalMs=${s.totalMs ?? "?"} task: ${s.task.slice(0, 150)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Run the curator on a single request. Returns the validated candidates,
 * or [] on any failure (LLM down, bad JSON, missing env). Never throws.
 */
export async function curateImprovements(req: CuratorRequest): Promise<ImprovementCandidate[]> {
  if (req.newNegatives.length === 0) return [];
  if (!LITELLM_API_KEY) {
    log.warn("[failure-curator] LITELLM_API_KEY not set — skipping");
    return [];
  }

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
          { role: "user",   content: buildUserPrompt(req) },
        ],
        tools: [EMIT_CANDIDATES_TOOL],
        tool_choice: { type: "function", function: { name: "emit_improvement_candidates" } },
        temperature: 0.2,
      }),
    }, { timeoutMs: CURATOR_TIMEOUT_MS, label: "failure-curator" });
    if (!res.ok) {
      log.warn(`[failure-curator] LiteLLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return [];
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      log.warn("[failure-curator] no tool_call in response");
      return [];
    }
    const parsed = JSON.parse(args) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    const validNegativeIds = new Set(req.newNegatives.map((s) => s.sessionId));
    return parsed.candidates
      .filter((c): c is ImprovementCandidate => validCandidate(c, validNegativeIds))
      .slice(0, MAX_CANDIDATES_PER_BATCH);
  } catch (err) {
    log.warn("[failure-curator] failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

function validCandidate(c: unknown, validIds: Set<string>): c is ImprovementCandidate {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (!BUCKETS.includes(o["bucket"] as Bucket)) return false;
  if (!ROOT_CAUSES.includes(o["rootCause"] as RootCause)) return false;
  if (typeof o["finding"] !== "string" || o["finding"].length < 12) return false;
  if (!Array.isArray(o["evidence"]) || o["evidence"].length < 2) return false;
  if (!o["evidence"].every((s) => typeof s === "string" && validIds.has(s))) return false;
  const fix = o["proposedFix"];
  if (!fix || typeof fix !== "object") return false;
  const f = fix as Record<string, unknown>;
  if (!FIX_TYPES.includes(f["type"] as FixType)) return false;
  if (typeof f["description"] !== "string" || f["description"].length < 8) return false;
  if (!CONFIDENCE.includes(o["confidence"] as Confidence)) return false;
  return true;
}
