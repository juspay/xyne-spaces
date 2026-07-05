/**
 * Boss judge for `/goal` autonomous loops.
 *
 * Worker = the user's chosen agent (sonnet/opus/etc.) executing turn after turn.
 * Boss   = this judge, running on LITELLM.fastModel, evaluating the full
 *          session trace after each turn to decide whether the goal is met.
 *
 * Mirrors the structure of chain-judge.ts: forced tool-call returns a strict
 * `{ done, reason }` JSON object. On any failure (LLM down, parse error,
 * timeout) the judge defaults to `{ done: false, reason: "judge_unavailable" }`
 * — the relooper combines this with max-turn/cost guards so a judge outage
 * never strands a goal in an infinite loop.
 */
import { LITELLM } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("goal-judge");

// Default 30 minutes. LiteLLM can be very slow under load, and a timed-out
// judge fails open to "judge_unavailable" — which strips the loop of its
// smart termination (completed/stuck/infeasible). Better to wait out a slow
// LiteLLM than to blind the judge. Override per-env with GOAL_JUDGE_TIMEOUT_MS.
const JUDGE_TIMEOUT_MS = Number(process.env["GOAL_JUDGE_TIMEOUT_MS"] ?? 1_800_000);

export interface GoalJudgeAttachmentMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface GoalJudgeInput {
  /** Verbatim user-supplied goal condition (e.g. "all unit tests pass"). */
  condition: string;
  /** Output of the most recently completed turn (kept separate for recency). */
  lastTurnOutput: string;
  /** 1-based turn count after this turn. */
  turnCount: number;
  /** Hard cap from the goal record. Boss may STOP earlier on overrun signals. */
  maxTurns: number;
  /** Optional: bounded trace of prior turns plus the latest turn. */
  recentTurnsDigest?: string;
  /** Files the worker attached to its reply this turn — metadata only (no
   *  bytes). Surfaces non-text artefacts (HTML reports, CSV, PDFs, …) to the
   *  judge so goals like "produce an HTML dashboard" aren't falsely failed
   *  because the judge can only see the text body otherwise. */
  attachmentsThisTurn?: GoalJudgeAttachmentMeta[];
}

export interface GoalJudgeDecision {
  done: boolean;
  reason: string;
}

const SYSTEM_PROMPT = `You are the BOSS of an autonomous agent loop.

A WORKER agent runs turn after turn pursuing a goal the user set with /goal. After EVERY turn you evaluate the full observed session trace, not just the latest message.

## Decision rules

### 1. Goal satisfaction
- Derive proof obligations from the goal condition. If the goal requires checking users, members, scopes, files, tests, APIs, or other concrete targets, require observed evidence that those targets were actually queried or acted on.
- Compare the required coverage against ALL session evidence. Return done=false when required evidence/actions are missing, for example when a member/user/scope named or implied by the goal was never queried.
- Return done=true with reason starting "completed:" only when the exit condition is satisfied by observed evidence across the trace.

### 2. Feasibility check
ONLY apply this when the goal mentions an explicit COUNT or scope size (e.g. "all 777 PRs", "every microservice in the org", "the 50 files", "all merged PRs"). Skip for open-ended goals like "make the dashboard pretty".

With at least one prior turn of progress data, compute:
  rate            = items_processed_so_far / turns_elapsed
  turns_needed    = remaining_items / rate
  turns_remaining = maxTurns - turnCount

If turns_needed > turns_remaining * 1.2 (20% headroom):
  → Vote done=true with reason starting "infeasible:" and a one-line math summary.
  Example: "infeasible: 5/turn × 4 turns left = 20 more, but 752 PRs remain. Need ~150 turns. Recommend wider concurrency or scheduled job."

Do NOT keep voting continue when the math is hopeless — stopping early lets the user adjust scope before burning the rest of the budget. "Worker making steady progress, should continue" is the WRONG verdict when the steady progress can't cover the remaining work in remaining turns.

### 3. Stuck detection
Vote done=true with reason starting "stuck:" when:
- Worker produced zero net progress for 2 consecutive turns
- Worker is repeatedly asking the user for input ("should I", "do you want me to", trailing question mark)
- Worker is making the same tool calls with the same args in circles

### 4. Artefact awareness
- The "Files attached this turn" section lists files the worker ALREADY uploaded as attachments to its reply (you can't see file contents, only fileName + mimeType + size).
- When the goal mentions producing a file/report/document/dashboard/CSV/PDF/HTML, an entry in that list with the appropriate type and a non-zero size is evidence of completion. Do NOT vote continue with reasons like "no file was created" when one is listed.
- A 0-byte file or a file with the wrong type is still missing evidence.

You MUST call the \`decide\` tool. Reason ≤ 160 chars (raised from 80 to fit feasibility math), plain English, no markdown. Prefix the reason with one of: "completed:", "infeasible:", "stuck:", or "continue:" (when voting done=false).`;

const DECIDE_TOOL = {
  type: "function" as const,
  function: {
    name: "decide",
    description: "Return done=true to terminate the loop, done=false to run another turn.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        done: { type: "boolean" },
        reason: { type: "string", description: "≤160 chars. Prefix with completed:/infeasible:/stuck:/continue:" },
      },
      required: ["done", "reason"],
    },
  },
};

export async function judgeGoalProgress(input: GoalJudgeInput): Promise<GoalJudgeDecision> {
  if (!LITELLM.apiKey) {
    return { done: false, reason: "judge_unavailable" };
  }

  // Render attachment metadata (top 20 by order, name + type + KB size).
  // We deliberately cap so a worker that dumps 100 small files can't blow
  // up the judge's context.
  const attachments = (input.attachmentsThisTurn ?? []).slice(0, 20);
  const attachmentsBlock =
    attachments.length > 0
      ? attachments
          .map(
            (a) =>
              `- ${a.fileName} (${a.mimeType || "unknown"}, ${Math.max(1, Math.round(a.sizeBytes / 1024))} KB)`,
          )
          .join("\n")
      : "(none)";

  const userContent = [
    `Goal condition: ${input.condition}`,
    `Turn: ${input.turnCount} / ${input.maxTurns}`,
    "",
    "--- Session trace (oldest to newest, may be truncated) ---",
    input.recentTurnsDigest || "(no prior session trace provided)",
    "",
    "--- Latest worker turn output ---",
    input.lastTurnOutput.slice(0, 4000),
    "",
    "--- Files attached this turn (metadata only — names/types/sizes) ---",
    attachmentsBlock,
  ].join("\n");

  try {
    const res = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.fastModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [DECIDE_TOOL],
        tool_choice: { type: "function", function: { name: DECIDE_TOOL.function.name } },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[goal-judge] LiteLLM ${res.status}: ${body.slice(0, 200)}`);
      return { done: false, reason: "judge_unavailable" };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      log.warn("[goal-judge] no tool_call in response — defaulting to continue");
      return { done: false, reason: "judge_unavailable" };
    }

    const parsed = JSON.parse(raw) as { done?: unknown; reason?: unknown };
    const done = parsed.done === true;
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 240) : "unspecified";
    return { done, reason };
  } catch (err) {
    log.warn(`[goal-judge] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { done: false, reason: "judge_unavailable" };
  }
}
