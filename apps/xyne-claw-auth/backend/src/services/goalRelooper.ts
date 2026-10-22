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
import { NEXT_TURN_TASK_TEMPLATE } from "../loop-graph/specs/goal.js";
import type { Prisma } from "@prisma/client";

export const GOAL_CONDITION_MAX_LENGTH = 2_000;

/** Canonical, bounded form used by both goal-card signing and execution. */
export function normalizeGoalCondition(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, GOAL_CONDITION_MAX_LENGTH);
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

export { recordTurnAndDecide, type RelooperDecision } from "../loop-graph/specs/goal.js";
