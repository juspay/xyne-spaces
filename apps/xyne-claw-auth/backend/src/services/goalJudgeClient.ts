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
import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("goal-judge-client", createTraceId());
// Default 30 minutes — must match (or exceed) the inner judge timeout in
// xyne-claw's goal-judge.ts, otherwise this outer S2S call aborts first and we
// get judge_unavailable even while the judge is still working. Shared env var
// GOAL_JUDGE_TIMEOUT_MS overrides both.
const JUDGE_TIMEOUT_MS = Number(process.env["GOAL_JUDGE_TIMEOUT_MS"] ?? 1_800_000);

export interface GoalJudgeAttachmentMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface GoalJudgeRequest {
  condition: string;
  lastTurnOutput: string;
  turnCount: number;
  maxTurns: number;
  recentTurnsDigest?: string;
  /** Metadata for files the worker attached this turn. Forwarded to claw's
   *  judge so artefact goals (HTML reports, CSVs) aren't false-negatived. */
  attachmentsThisTurn?: GoalJudgeAttachmentMeta[];
}

export interface GoalJudgeDecision {
  done: boolean;
  reason: string;
}

export async function judgeGoalViaClaw(req: GoalJudgeRequest): Promise<GoalJudgeDecision> {
  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[goal-judge-client] XYNE_CLAW_S2S_KEY not set — refusing call");
    return { done: false, reason: "judge_unavailable" };
  }
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/goal-judge`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[goal-judge-client] non-OK from claw", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return { done: false, reason: "judge_unavailable" };
    }
    const data = (await res.json()) as { success?: boolean; done?: boolean; reason?: string };
    if (!data.success || typeof data.done !== "boolean" || typeof data.reason !== "string") {
      logger.warn("[goal-judge-client] malformed response", { data });
      return { done: false, reason: "judge_unavailable" };
    }
    return { done: data.done, reason: data.reason };
  } catch (err) {
    logger.error("[goal-judge-client] call failed", {
      err: errMsg(err),
    });
    return { done: false, reason: "judge_unavailable" };
  }
}
