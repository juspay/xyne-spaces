import { activeGoalRepository, type AuditState } from "../../repositories/activeGoalRepository.js";
import { judgeGoalViaClaw } from "../../services/goalJudgeClient.js";
import { advanceLoop, passesExhausted, type LoopSpec } from "../engine.js";

export const NEXT_TURN_TASK_TEMPLATE = (
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

export type RelooperDecision =
  | { kind: "noActiveGoal" }
  | { kind: "terminated"; reason: string; replyToUser: string }
  | { kind: "continue"; nextTurnTask: string; runPayload: Record<string, unknown>; replyToUser: string };

type ActiveGoal = Awaited<ReturnType<typeof activeGoalRepository.recordTurn>>;

export interface GoalLedger {
  goal: ActiveGoal;
  lastTurnResult: string;
  sessionTraceDigest: string;
  attachmentsThisTurn?: Array<{ fileName: string; mimeType: string; sizeBytes: number }>;
  verdict?: { done: boolean; reason: string };
}

type GoalSpec = LoopSpec<GoalLedger, Record<string, never>, RelooperDecision>;

const runPayloadOf = (ledger: GoalLedger) => ledger.goal.runPayload as Record<string, unknown>;
const turnLine = (ledger: GoalLedger) => `${ledger.goal.turnCount}/${ledger.goal.maxTurns}`;

async function terminate(ledger: GoalLedger, status: "done" | "failed", reason: string, replyToUser: string) {
  await activeGoalRepository.terminate(ledger.goal.conversationId, status, reason);
  return { output: { kind: "terminated" as const, reason, replyToUser } };
}

async function setAudit(ledger: GoalLedger, auditState: AuditState) {
  await activeGoalRepository.setAuditState(ledger.goal.conversationId, auditState);
}

export const goalLoop: GoalSpec = {
  id: "goal",
  policy: {
    maxPasses: (ledger) => ledger.goal.maxTurns,
    passes: (ledger) => ledger.goal.turnCount,
    onTimeout: "stop",
  },
  nodes: {
    turnLimit: {
      kind: "end",
      run: (ledger) =>
        terminate(
          ledger,
          "failed",
          `max_turns_reached:${ledger.goal.maxTurns}`,
          `**/goal stopped — turn limit (${ledger.goal.maxTurns}) reached.**`,
        ),
    },
    fix: {
      kind: "pass",
      run: async (ledger) => {
        await setAudit(ledger, "done");
        return {
          output: {
            kind: "continue",
            nextTurnTask: AUDIT_REOPEN_TASK_TEMPLATE(ledger.goal.condition),
            runPayload: runPayloadOf(ledger),
            replyToUser: `_Turn ${turnLine(ledger)} — audit flagged issues, fixing_`,
          },
        };
      },
    },
    auditPassed: {
      kind: "end",
      run: async (ledger) => {
        await setAudit(ledger, "done");
        return terminate(ledger, "done", "audit_passed", `**/goal complete — audit verified the result.**`);
      },
    },
    judge: {
      kind: "decide",
      run: async (ledger) => {
        const verdict = await judgeGoalViaClaw({
          condition: ledger.goal.condition,
          lastTurnOutput: ledger.lastTurnResult,
          recentTurnsDigest: ledger.sessionTraceDigest,
          turnCount: ledger.goal.turnCount,
          maxTurns: ledger.goal.maxTurns,
          ...(ledger.attachmentsThisTurn && ledger.attachmentsThisTurn.length > 0
            ? { attachmentsThisTurn: ledger.attachmentsThisTurn }
            : {}),
        });
        return { ledger: { ...ledger, verdict } };
      },
    },
    audit: {
      kind: "pass",
      run: async (ledger) => {
        await setAudit(ledger, "pending");
        return {
          output: {
            kind: "continue",
            nextTurnTask: AUDIT_TASK_TEMPLATE(ledger.goal.condition),
            runPayload: runPayloadOf(ledger),
            replyToUser: `_Turn ${turnLine(ledger)} — judge says done, running audit pass_`,
          },
        };
      },
    },
    met: {
      kind: "end",
      run: (ledger) => {
        const reason = ledger.verdict?.reason ?? "";
        return terminate(ledger, "done", reason, `**/goal complete — ${reason}**`);
      },
    },
    work: {
      kind: "pass",
      run: async (ledger) => ({
        output: {
          kind: "continue",
          nextTurnTask: NEXT_TURN_TASK_TEMPLATE(ledger.goal.condition, {
            turnCount: ledger.goal.turnCount,
            maxTurns: ledger.goal.maxTurns,
          }),
          runPayload: runPayloadOf(ledger),
          replyToUser: `_Turn ${turnLine(ledger)} — ${ledger.verdict?.reason ?? ""}_`,
        },
      }),
    },
  },
  edges: [
    { from: "*", on: "turn", to: "turnLimit", label: "turn limit reached", when: (ledger) => passesExhausted(goalLoop.policy, ledger) },
    { from: "audit", on: "turn", to: "fix", label: "audit reopened", when: (ledger) => ledger.lastTurnResult.includes(GOAL_REOPEN_TOKEN) },
    { from: "audit", on: "turn", to: "auditPassed", label: "audit clean" },
    { from: "work", on: "turn", to: "judge", label: "turn finished" },
    { from: "judge", on: "done", to: "audit", label: "met, not yet audited", when: (ledger) => Boolean(ledger.verdict?.done) && ledger.goal.auditState === "none" },
    { from: "judge", on: "done", to: "met", label: "met after audit", when: (ledger) => Boolean(ledger.verdict?.done) },
    { from: "judge", on: "done", to: "work", label: "not met" },
  ],
};

export async function recordTurnAndDecide(args: {
  conversationId: string;
  lastTurnResult: string;
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
  const goal = await activeGoalRepository.recordTurn(conversationId, lastTurnResult, sessionTraceDigest);
  const step = await advanceLoop(goalLoop, {
    from: goal.auditState === "pending" ? "audit" : "work",
    on: "turn",
    ledger: { goal, lastTurnResult, sessionTraceDigest, ...(attachmentsThisTurn ? { attachmentsThisTurn } : {}) },
    ctx: {},
  });
  if (!step.output) throw new Error(`[goal] loop stopped without a decision for ${conversationId}`);
  return step.output;
}
