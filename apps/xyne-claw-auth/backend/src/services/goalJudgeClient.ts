/**
 * Thin HTTP client for claw's POST /goal-judge endpoint.
 *
 * Same "LLM-on-claw-only" invariant as sessionCurator and user-memory-curator:
 * the LiteLLM key lives on claw, so the judge call goes there over S2S.
 *
 * Returns `{ done: false, reason: "judge_unavailable" }` on any failure
 * (claw down, S2S mismatch, timeout, bad JSON). The relooper combines this
 * with max-turn + cost guards so a transient judge outage never strands a
 * goal in an infinite loop.
 */
import {
  GOAL_JUDGE_UNAVAILABLE_REASON,
  type GoalJudgeDecision,
  type GoalJudgeRequest,
} from "xyne-claw-shared";
import { createLogger, createTraceId } from "../logger.js";
import { postToClaw } from "./clawS2sClient.js";

export type { GoalJudgeAttachmentMeta, GoalJudgeDecision, GoalJudgeRequest } from "xyne-claw-shared";

const logger = createLogger("goal-judge-client", createTraceId());
// Default 30 minutes — must match (or exceed) the inner judge timeout in
// xyne-claw's goal-judge.ts, otherwise this outer S2S call aborts first and we
// get judge_unavailable even while the judge is still working. Shared env var
// GOAL_JUDGE_TIMEOUT_MS overrides both.
const JUDGE_TIMEOUT_MS = Number(process.env["GOAL_JUDGE_TIMEOUT_MS"] ?? 1_800_000);

const UNAVAILABLE: GoalJudgeDecision = { done: false, reason: GOAL_JUDGE_UNAVAILABLE_REASON };

export async function judgeGoalViaClaw(req: GoalJudgeRequest): Promise<GoalJudgeDecision> {
  const result = await postToClaw("/goal-judge", req, { timeoutMs: JUDGE_TIMEOUT_MS });
  if (!result.ok) {
    if (result.kind === "no-key") {
      logger.warn("[goal-judge-client] XYNE_CLAW_S2S_KEY not set — refusing call");
    } else if (result.kind === "http") {
      logger.warn("[goal-judge-client] non-OK from claw", { status: result.status, body: result.body });
    } else {
      logger.error("[goal-judge-client] call failed", { err: result.error });
    }
    return { ...UNAVAILABLE };
  }
  const data = result.data as { success?: boolean; done?: boolean; reason?: string } | null;
  if (!data || !data.success || typeof data.done !== "boolean" || typeof data.reason !== "string") {
    logger.warn("[goal-judge-client] malformed response", { data });
    return { ...UNAVAILABLE };
  }
  return { done: data.done, reason: data.reason };
}
