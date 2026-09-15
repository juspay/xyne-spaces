/**
 * Goal relooper service — owns the lifecycle of an active /goal autonomous
 * loop for a Spaces conversation.
 *
 * Three entry points, all called from webhook.ts:
 *   - handleSlashCommandBeforeRun  → intercepts /goal | /stop on inbound user text
 *   - recordTurnAndDecide          → called from /webhook/result after each claw turn
 *
 * The relooper does NOT post to Spaces or refire claw itself — it returns a
 * structured `RelooperDecision` and the caller wires the actual fetch / post
 * calls. That separation keeps the service unit-testable and keeps the
 * existing webhook.ts plumbing (spacesAppFetch, run-recovery registration,
 * progress signalling) where it already lives.
 */

import { activeGoalRepository } from "../repositories/activeGoalRepository.js";
import { judgeGoalViaClaw } from "./goalJudgeClient.js";
import type { Prisma } from "@prisma/client";

export const GOAL_CONDITION_MAX_LENGTH = 2_000;

/** Canonical, bounded form used by both goal-card signing and execution. */
export function normalizeGoalCondition(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, GOAL_CONDITION_MAX_LENGTH);
}

const NEXT_TURN_TASK_TEMPLATE = (
  condition: string,
  ctx?: { turnCount?: number; maxTurns?: number },
): string => {
  // Turn metadata is optional so old callers (e.g. firstTurn at line 148, where
  // turnCount is 0) still compile. The throughput-check block only kicks in
  // when we have at least one turn of progress data — turnCount >= 2.
  const turnLine =
    ctx?.turnCount != null && ctx?.maxTurns != null
      ? `\n\nLoop state: turn ${ctx.turnCount} of ${ctx.maxTurns} (turns remaining: ${Math.max(0, ctx.maxTurns - ctx.turnCount)}).`
      : "";

  const throughputBlock =
    (ctx?.turnCount ?? 0) >= 2
      ? `

## Throughput self-check (BEFORE you start this turn's work)

If the exit condition mentions an explicit COUNT of items (e.g. "all 777 PRs",
"every microservice", "the 50 files"):

  1. Look at your prior turns. Count items_processed_so_far.
  2. Estimate rate = items_processed_so_far / turns_elapsed.
  3. Project turns_needed = remaining_items / rate.
  4. Compare against turns_remaining (above).

If turns_needed > turns_remaining * 1.5:
  REPLY ONCE with a single message:
    "Infeasible at current pace. At {rate}/turn, {remaining} of {total}
     items would need ~{turns_needed} more turns vs {turns_remaining}
     remaining. Options: (a) raise concurrency from X to Y per turn,
     (b) schedule a recurring job that auto-resumes, (c) reduce scope.
     Pausing for your input."
  Then STOP this turn — do NOT fire more subagents. The judge will see
  your message (and arrive at the same math independently) and terminate
  the loop with a clear reason for the user.

Do NOT silently keep processing at an inadequate rate while turns run
out. The user would rather see "this won't finish" at turn 2 than
"turn limit reached, 25/777 done" at turn 5.

For open-ended goals without a target count, ignore this section.`
      : "";

  return (
    `You are in an autonomous /goal loop. Continue making progress.\n\nExit condition: ${condition}` +
    turnLine +
    throughputBlock +
    `\n\nThe system will judge after each turn whether the condition is met. If you cannot make further progress without human input, say so explicitly so the judge can stop the loop.`
  );
};

/**
 * Audit task — fired ONCE after the boss judge first votes done. Asks the
 * worker to critically re-examine its own previous output for material
 * errors (wrong numbers, missed items, false claims) before terminating.
 *
 * If the worker finds problems it MUST write the literal token
 * `GOAL_REOPEN` somewhere in its response and describe what's wrong. The
 * relooper then continues the loop with `AUDIT_REOPEN_TASK_TEMPLATE` so
 * the worker fixes the specific issues instead of restarting.
 *
 * If the response is clean (no GOAL_REOPEN token) the goal terminates as
 * the judge originally intended. We only audit once per goal — a second
 * judge-done vote after a reopen-and-fix cycle terminates without
 * re-auditing.
 *
 * Defends against the LLM-judge weakness where a confidently-written but
 * factually wrong worker output passes the judge (e.g. Euler Dispatch's
 * 2026-05-27 dashboard claimed 58 PRs when reality was 27).
 */
const AUDIT_TASK_TEMPLATE = (condition: string): string =>
  `AUDIT PASS — the judge thinks your previous response satisfies the exit condition. Before we terminate, reflect critically on what you just wrote.

Exit condition: ${condition}

Re-examine every concrete claim in your previous turn:
- For any numeric counts: re-query the source system and confirm the count matches what you reported.
- For any list of items (PRs, tickets, repositories, etc.): verify completeness — did you miss any that should have been included? Did you include any that shouldn't have been?
- For categorical assertions ("X is correct", "Y didn't happen"): confirm they hold against the source data.

If you find a MATERIAL error (wrong number, missed/extra item, false claim that affects the outcome), write the literal token \`GOAL_REOPEN\` in your response and describe exactly what's wrong. The loop will then continue so you can fix it.

If your previous response was accurate, write a brief 1-2 sentence reflection confirming this WITHOUT the GOAL_REOPEN token. The goal will terminate cleanly.

Do NOT redo the entire task. Only verify and report on what you already produced.`;

const AUDIT_REOPEN_TASK_TEMPLATE = (condition: string): string =>
  `Your audit found errors in your previous response. Fix the specific issues you just identified — do not start over from scratch.

Exit condition: ${condition}

Output a corrected response that addresses each error you flagged in your audit. The judge will re-evaluate when you're done.`;

/** Literal token the worker emits in its audit response to indicate it
 *  found material errors and the goal should be reopened for a fix turn. */
const GOAL_REOPEN_TOKEN = "GOAL_REOPEN";

const SESSION_TRACE_DIGEST_MAX_CHARS = 12_000;
const SESSION_TRACE_TURN_MAX_CHARS = 4_000;

function buildSessionTraceDigest(args: {
  priorDigest?: string | null;
  turnNumber: number;
  latestTurnOutput: string;
}): string {
  const latestTurn =
    `--- Turn ${args.turnNumber} ---\n` + args.latestTurnOutput.slice(0, SESSION_TRACE_TURN_MAX_CHARS);
  const combined = [args.priorDigest?.trim(), latestTurn].filter(Boolean).join("\n\n");
  return combined.length > SESSION_TRACE_DIGEST_MAX_CHARS
    ? combined.slice(-SESSION_TRACE_DIGEST_MAX_CHARS)
    : combined;
}

export type SlashIntercept =
  | {
      kind: "goalStarted";
      condition: string;
      firstTurnTask: string;
      replyToUser: string;
      providerOverride?: { provider: string; model?: string };
    }
  | { kind: "goalStatusReply"; replyToUser: string }
  | { kind: "goalCleared"; replyToUser: string }
  | { kind: "passthrough" };

/**
 * Decide what to do with a user message that may or may not be a slash
 * command. Returns one of:
 *   - "goalStarted"      : caller should record the goal, then run claw with
 *                          firstTurnTask AS the task (DO post replyToUser
 *                          first as an acknowledgement).
 *   - "goalStatusReply"  : caller should post replyToUser and return — DO NOT
 *                          run claw for this message.
 *   - "goalCleared"      : caller should post replyToUser and return — DO NOT
 *                          run claw.
 *   - "passthrough"      : not a slash command (or unrecognised) — caller
 *                          continues with normal task processing.
 */
export async function handleSlashCommandBeforeRun(args: {
  command: import("../lib/parseSlashCommand.js").SlashCommand | null;
  conversationId: string;
}): Promise<SlashIntercept> {
  const { command, conversationId } = args;
  if (!command) return { kind: "passthrough" };

  if (command.kind === "goalStatus") {
    const goal = await activeGoalRepository.findActiveByConversation(conversationId);
    if (!goal) {
      return { kind: "goalStatusReply", replyToUser: "No active /goal in this thread." };
    }
    // Status is the only place the condition is genuinely useful (the user is
    // asking what goal is running). Cap it so a multi-paragraph goal doesn't
    // flood the thread.
    const condPreview = goal.condition.length > 120
      ? `${goal.condition.slice(0, 117)}…`
      : goal.condition;
    return {
      kind: "goalStatusReply",
      replyToUser:
        `**/goal status** — turn ${goal.turnCount}/${goal.maxTurns}` +
        (goal.lastReason ? ` · last: ${goal.lastReason}` : "") +
        `\n_${condPreview}_`,
    };
  }

  if (command.kind === "goalClear") {
    const goal = await activeGoalRepository.findActiveByConversation(conversationId);
    if (!goal) {
      return { kind: "goalCleared", replyToUser: "No active /goal to clear." };
    }
    await activeGoalRepository.terminate(conversationId, "cancelled", "user_cleared");
    // Don't echo the condition — user just typed `/stop`, they know what they
    // started.
    return { kind: "goalCleared", replyToUser: "Cleared /goal." };
  }

  // Non-goal commands (/clear, /compact) are handled by the caller, not here —
  // narrow the union so the goalStart access below typechecks.
  if (command.kind !== "goalStart") return { kind: "passthrough" };

  // goalStart — the caller still has to record the row with the run-dispatch
  // payload (only they assemble it). We surface the condition + the first
  // turn's task here so the caller doesn't need to know the wording.
  return {
    kind: "goalStarted",
    condition: command.condition,
    firstTurnTask: NEXT_TURN_TASK_TEMPLATE(command.condition),
    ...(command.providerOverride ? { providerOverride: command.providerOverride } : {}),
    // Don't echo the condition back — the user just typed it, the thread
    // already contains it. A short, fixed ack keeps the thread clean even
    // when the goal is multi-paragraph.
    replyToUser: "Starting /goal — working on it until done or turn limit.",
  };
}

/** Record-and-store helper for the goal start — wraps the repo upsert. */
export async function persistGoalStart(args: {
  conversationId: string;
  channelId?: string | null;
  workspaceId?: string | null;
  userId: string;
  agentSlug: string;
  orgId: string;
  condition: string;
  runPayload: Prisma.InputJsonValue;
  maxTurns?: number;
}): Promise<void> {
  await activeGoalRepository.startOrReplace(args);
}

export type RelooperDecision =
  | { kind: "noActiveGoal" }
  | { kind: "terminated"; reason: string; replyToUser: string }
  | { kind: "continue"; nextTurnTask: string; runPayload: Record<string, unknown>; replyToUser: string };

/**
 * Called from /webhook/result after each turn finishes (after the worker's
 * result has been posted to Spaces). Records the turn, evaluates via the
 * boss judge, and returns what the caller should do next.
 *
 * Caller responsibilities:
 *   - "terminated" : post `replyToUser` (it's the "Goal achieved" / "Hit
 *                    turn limit" line).
 *   - "continue"   : post `replyToUser` (a one-liner like "Turn 3/20 —
 *                    continuing..."), then fire claw's /run with `runPayload`
 *                    and `task = nextTurnTask`.
 *
 * Boss outage (judge_unavailable) does NOT terminate the goal — the relooper
 * continues until either the boss recovers or maxTurns is hit. This matches
 * the "judge unavailable means default-continue with hard caps" design.
 */
export async function recordTurnAndDecide(args: {
  conversationId: string;
  lastTurnResult: string;
  /** Optional: metadata for files the worker attached to its reply this
   *  turn. Pass-through to the boss judge so goals like "produce an HTML
   *  report" aren't falsely failed because the judge can only see the text
   *  body otherwise. The caller pulls this from the inbound /webhook/result
   *  payload — see webhook.ts. */
  attachmentsThisTurn?: Array<{ fileName: string; mimeType: string; sizeBytes: number }>;
}): Promise<RelooperDecision> {
  const { conversationId, lastTurnResult, attachmentsThisTurn } = args;
  const existing = await activeGoalRepository.findActiveByConversation(conversationId);
  if (!existing) return { kind: "noActiveGoal" };

  const sessionTraceDigest = buildSessionTraceDigest({
    priorDigest: existing.lastTurnResult,
    turnNumber: existing.turnCount + 1,
    latestTurnOutput: lastTurnResult,
  });

  // Bump turn count and stash the session trace digest for audit + the judge.
  const updated = await activeGoalRepository.recordTurn(conversationId, lastTurnResult, sessionTraceDigest);
  const runPayload = updated.runPayload as Record<string, unknown>;

  // Hard cap — terminate before bothering the judge if we've exhausted turns.
  // Applied even mid-audit to guarantee the loop always halts.
  if (updated.turnCount >= updated.maxTurns) {
    await activeGoalRepository.terminate(conversationId, "failed", `max_turns_reached:${updated.maxTurns}`);
    return {
      kind: "terminated",
      reason: `max_turns_reached:${updated.maxTurns}`,
      replyToUser: `**/goal stopped — turn limit (${updated.maxTurns}) reached.**`,
    };
  }

  // ── AUDIT BRANCH ────────────────────────────────────────────────────────
  // The previous turn was an audit pass (we set state="pending" last time).
  // Don't run the judge — instead parse the worker's audit response for
  // the GOAL_REOPEN sentinel.
  if (updated.auditState === "pending") {
    const reopen = lastTurnResult.includes(GOAL_REOPEN_TOKEN);
    await activeGoalRepository.setAuditState(conversationId, "done");
    if (reopen) {
      // Worker flagged errors — continue with a focused fix turn. No further
      // audits will be triggered (auditState stays "done").
      return {
        kind: "continue",
        nextTurnTask: AUDIT_REOPEN_TASK_TEMPLATE(updated.condition),
        runPayload,
        replyToUser: `_Turn ${updated.turnCount}/${updated.maxTurns} — audit flagged issues, fixing_`,
      };
    }
    // Clean audit — terminate as the original judge intended.
    await activeGoalRepository.terminate(conversationId, "done", "audit_passed");
    return {
      kind: "terminated",
      reason: "audit_passed",
      replyToUser: `**/goal complete — audit verified the result.**`,
    };
  }
  // ────────────────────────────────────────────────────────────────────────

  const decision = await judgeGoalViaClaw({
    condition: updated.condition,
    lastTurnOutput: lastTurnResult,
    recentTurnsDigest: sessionTraceDigest,
    turnCount: updated.turnCount,
    maxTurns: updated.maxTurns,
    ...(attachmentsThisTurn && attachmentsThisTurn.length > 0
      ? { attachmentsThisTurn }
      : {}),
  });

  if (decision.done) {
    // First done vote → kick off an audit instead of terminating. Defends
    // against the LLM judge approving confidently-wrong worker output.
    // We only ever audit once per goal (auditState transitions "none" →
    // "pending" → "done" and never goes back to "none" within the same goal).
    if (updated.auditState === "none") {
      await activeGoalRepository.setAuditState(conversationId, "pending");
      return {
        kind: "continue",
        nextTurnTask: AUDIT_TASK_TEMPLATE(updated.condition),
        runPayload,
        replyToUser: `_Turn ${updated.turnCount}/${updated.maxTurns} — judge says done, running audit pass_`,
      };
    }
    // auditState === "done" — already audited (and either passed or reopened
    // + fixed). Now the judge votes done again. Terminate without a second
    // audit.
    await activeGoalRepository.terminate(conversationId, "done", decision.reason);
    return {
      kind: "terminated",
      reason: decision.reason,
      replyToUser: `**/goal complete — ${decision.reason}**`,
    };
  }

  // Continue: surface the stashed runPayload (cast: prisma Json comes back
  // as JsonValue, but it was always an object when stored).
  return {
    kind: "continue",
    nextTurnTask: NEXT_TURN_TASK_TEMPLATE(updated.condition, {
      turnCount: updated.turnCount,
      maxTurns: updated.maxTurns,
    }),
    runPayload,
    replyToUser: `_Turn ${updated.turnCount}/${updated.maxTurns} — ${decision.reason}_`,
  };
}
