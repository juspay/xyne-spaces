/**
 * FailureCurator — negative-session detection layer.
 *
 * Three SQL passes, one per bucket, all incremental (only sessions completed
 * AFTER lastProcessedAt). Returns sessionIds + minimal context the curator
 * needs to prompt the LLM. Heavy fields like full toolInvocations are pulled
 * lazily by the consumer to keep this helper cheap.
 *
 *   agent_unable_to_do_work — soft-refusal text OR low-effort completion,
 *                             AND user did not engage within 30 min
 *   failure                  — status='failed'/'cancelled' OR llmRetries>0
 *                             OR lastRetryReason populated
 *   user_frustrated          — follow-up message from same user in same
 *                             conversation matches frustration regex
 *
 * The user-frustrated detector needs chat_messages (or a follow-up in
 * agent_runs as a proxy). We use BOTH so a frustration follow-up via
 * another agent's webhook is still picked up.
 */

import { Prisma } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";

import { createLogger } from "../logger.js";
const log = createLogger("failure-curator-detection");

// Apologetic / deferral pattern used both by sentiment Layer A and by the
// "agent_unable_to_do_work" bucket. Single source of truth so both stay in
// sync. POSIX regex syntax — Postgres ~* is case-insensitive.
//
// Loosened (2026-06-06) to catch real production agent text. Original
// pattern was so tight that workspace-wide backfill found <3 hits/agent and
// skipped every agent silently. New patterns capture the more common
// "polite refusal" phrasings that don't use the exact word "sorry".
const SOFT_REFUSAL_REGEX =
  String.raw`\m(I couldn|I can\W?t|I don\W?t have|I don\W?t know|sorry|unable to|cannot|I am not able|I do not have|out of scope|beyond (my|what I can)|no findings|I was unable|you (may|might|should|could)|you\W?ll need to|consider asking|I would need|if you (can|could) provide|let me know if|based on the information|I (was|am) not (able|sure)|without (more|additional)|I do(n\W?t)? have access|I\W?m (not|unable) (sure|able)|insufficient|not enough (data|context|information))`;

const FRUSTRATION_REGEX =
  String.raw`\m(useless|doesn\W?t work|that\W?s not (it|right|what)|that didn\W?t (work|help)|forget it|nevermind|never mind|ugh+|wtf|what the|stupid|annoying|frustrating|waste of time|why (isn\W?t|can\W?t|wouldn\W?t|don\W?t)|I\W?ll just|I\W?ll do it (myself|manually)|this is (broken|wrong|bad)|not what I (asked|wanted)|no(\s|,)+that\W?s|wrong|incorrect|bad answer)`;

// Knob: relax the "low-effort completion" filter for agent_unable_to_do_work.
// The original (toolMs=0 AND llmTurns≤2 AND totalMs<15s) is rarely hit by
// real agents that use any tools at all. Loosened to also catch sessions
// where the agent produced a very short answer (likely a stub deferral).
const LOW_EFFORT_TOTAL_MS_MAX = Number(process.env["FAILURE_CURATOR_LOW_EFFORT_MS"] ?? 25_000);
const LOW_EFFORT_TURNS_MAX    = Number(process.env["FAILURE_CURATOR_LOW_EFFORT_TURNS"] ?? 3);
const LOW_EFFORT_RESULT_LEN   = Number(process.env["FAILURE_CURATOR_SHORT_RESULT_CHARS"] ?? 250);

export interface NegativeSession {
  sessionId: string;
  bucket: "agent_unable_to_do_work" | "failure" | "user_frustrated";
  /** When the run completed (or failed). Used as the watermark advance. */
  completedAt: Date;
  /** Conversation this run belongs to — for cross-correlating frustration. */
  conversationId: string | null;
  userId: string;
  task: string;
  result: string | null;
  error: string | null;
  status: string;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  llmRetries: number | null;
  lastRetryReason: string | null;
  /** Tool invocations as JSON — the curator uses this to spot patterns like
   *  redundant subagent calls. Can be heavy; consider truncating in the
   *  caller before sending to the LLM. */
  toolInvocations: unknown;
  /** Only set on user_frustrated rows — the offending follow-up message
   *  text so the curator can quote it as evidence. */
  frustrationFollowup?: { text: string; sentAt: Date };
}

/**
 * Look at agent_runs that completed in [since, now). Returns one entry per
 * negative-bucket hit; the same sessionId can appear in multiple buckets if
 * it tripped more than one detector (the curator decides the primary).
 */
export async function selectNegativeSessions(opts: {
  orgId: string;
  agentSlug: string;
  since: Date;
  now: Date;
  /** Caller-side hard cap — keep payloads bounded if a hot agent fires many. */
  maxPerBucket?: number;
}): Promise<NegativeSession[]> {
  const cap = opts.maxPerBucket ?? 40;

  // ── (1) agent_unable_to_do_work ──────────────────────────────────────
  // status='completed', result matches soft-refusal OR low-effort, AND
  // no follow-up agent_run from the same user in the same conversation
  // within 30 minutes after completedAt.
  const unableRows = await prisma.$queryRaw<Array<{
    sessionId: string;
    completedAt: Date;
    conversationId: string | null;
    userId: string;
    task: string;
    result: string | null;
    error: string | null;
    status: string;
    totalMs: number | null;
    llmTotalMs: number | null;
    toolMs: number | null;
    llmRetries: number | null;
    lastRetryReason: string | null;
    toolInvocations: unknown;
  }>>(Prisma.sql`
    SELECT r."sessionId", r."completedAt", r."conversationId", r."userId",
           r."task", r."result", r."error", r.status,
           r."totalMs", r."llmTotalMs", r."toolMs", r."llmRetries",
           r."lastRetryReason", r."toolInvocations"
      FROM "agent_runs" r
     WHERE r."agentSlug" = ${opts.agentSlug}
       AND r."orgId" = ${opts.orgId}
       AND r."completedAt" >= ${opts.since}
       AND r."completedAt" <  ${opts.now}
       AND r.status = 'completed'
       AND (
              -- (i) text-level: result reads like a soft refusal / deferral
              (r.result IS NOT NULL AND r.result ~* ${SOFT_REFUSAL_REGEX})
              -- (ii) effort-level: very short total wall-clock with few turns,
              -- regardless of whether tools were used. Tunable via env.
           OR (COALESCE(r."llmTurns", 99) <= ${LOW_EFFORT_TURNS_MAX}
               AND COALESCE(r."totalMs", 99999999) < ${LOW_EFFORT_TOTAL_MS_MAX})
              -- (iii) very short final answer relative to a non-trivial task
           OR (r.result IS NOT NULL
               AND length(r.result) < ${LOW_EFFORT_RESULT_LEN}
               AND length(r.task) > 80)
       )
     ORDER BY r."completedAt" DESC
     LIMIT ${cap}
  `);

  // ── (2) failure ───────────────────────────────────────────────────────
  // Loud failures + retry storms.
  const failureRows = await prisma.$queryRaw<Array<{
    sessionId: string;
    completedAt: Date;
    conversationId: string | null;
    userId: string;
    task: string;
    result: string | null;
    error: string | null;
    status: string;
    totalMs: number | null;
    llmTotalMs: number | null;
    toolMs: number | null;
    llmRetries: number | null;
    lastRetryReason: string | null;
    toolInvocations: unknown;
  }>>(Prisma.sql`
    SELECT r."sessionId", r."completedAt", r."conversationId", r."userId",
           r."task", r."result", r."error", r.status,
           r."totalMs", r."llmTotalMs", r."toolMs", r."llmRetries",
           r."lastRetryReason", r."toolInvocations"
      FROM "agent_runs" r
     WHERE r."agentSlug" = ${opts.agentSlug}
       AND r."orgId" = ${opts.orgId}
       AND r."completedAt" >= ${opts.since}
       AND r."completedAt" <  ${opts.now}
       AND (
              r.status IN ('failed', 'cancelled')
           OR (r."llmRetries" IS NOT NULL AND r."llmRetries" > 0)
           OR r."lastRetryReason" IS NOT NULL
       )
     ORDER BY r."completedAt" DESC
     LIMIT ${cap}
  `);

  // ── (3) user_frustrated ──────────────────────────────────────────────
  // Two follow-up sources:
  //   (a) chat_messages (role='user') in the same conversation
  //   (b) a subsequent agent_run on the same conversation whose `task`
  //       (the user's next message) trips the frustration regex
  // Either way, we tag the run that PRECEDED the frustration.
  const frustratedRows = await prisma.$queryRaw<Array<{
    sessionId: string;
    completedAt: Date;
    conversationId: string | null;
    userId: string;
    task: string;
    result: string | null;
    error: string | null;
    status: string;
    totalMs: number | null;
    llmTotalMs: number | null;
    toolMs: number | null;
    llmRetries: number | null;
    lastRetryReason: string | null;
    toolInvocations: unknown;
    followup_text: string;
    followup_sent_at: Date;
  }>>(Prisma.sql`
    WITH followups AS (
      -- (a) chat_messages: user-role follow-up within 10 min after the
      -- agent completed. Catches frustration typed via Spaces chat.
      SELECT r."sessionId", r."completedAt", r."conversationId", r."userId",
             r."task", r."result", r."error", r.status,
             r."totalMs", r."llmTotalMs", r."toolMs", r."llmRetries",
             r."lastRetryReason", r."toolInvocations",
             cm.content::text AS followup_text,
             cm."createdAt"   AS followup_sent_at
        FROM "agent_runs" r
        JOIN "chat_messages" cm
          ON cm."conversationId" = r."conversationId"
         AND cm.role = 'user'
         AND cm."userId" = r."userId"
         AND cm."createdAt" >  r."completedAt"
         AND cm."createdAt" <= r."completedAt" + INTERVAL '10 minutes'
       WHERE r."agentSlug" = ${opts.agentSlug}
         AND r."orgId" = ${opts.orgId}
         AND r."completedAt" >= ${opts.since}
         AND r."completedAt" <  ${opts.now}
         AND cm.content ~* ${FRUSTRATION_REGEX}

      UNION ALL

      -- (b) next-turn agent_run task text -- works regardless of whether
      -- ChatMessage is populated. The next run task IS the user next
      -- typed message.
      SELECT r."sessionId", r."completedAt", r."conversationId", r."userId",
             r."task", r."result", r."error", r.status,
             r."totalMs", r."llmTotalMs", r."toolMs", r."llmRetries",
             r."lastRetryReason", r."toolInvocations",
             r2.task        AS followup_text,
             r2."startedAt" AS followup_sent_at
        FROM "agent_runs" r
        JOIN "agent_runs" r2
          ON r2."conversationId" = r."conversationId"
         AND r2."userId" = r."userId"
         AND r2."startedAt" >  r."completedAt"
         AND r2."startedAt" <= r."completedAt" + INTERVAL '10 minutes'
       WHERE r."agentSlug" = ${opts.agentSlug}
         AND r."orgId" = ${opts.orgId}
         AND r."completedAt" >= ${opts.since}
         AND r."completedAt" <  ${opts.now}
         AND r2.task ~* ${FRUSTRATION_REGEX}
    )
    SELECT DISTINCT ON ("sessionId") *
      FROM followups
     ORDER BY "sessionId", followup_sent_at ASC
     LIMIT ${cap}
  `).catch((err) => {
    // ChatMessage table might not exist in some environments; the agent_runs
    // branch alone is still useful. Log and degrade.
    log.warn("[failure-curator] frustrated query failed, returning empty:", errMsg(err));
    return [] as Array<{
      sessionId: string; completedAt: Date; conversationId: string | null;
      userId: string; task: string; result: string | null; error: string | null;
      status: string; totalMs: number | null; llmTotalMs: number | null;
      toolMs: number | null; llmRetries: number | null; lastRetryReason: string | null;
      toolInvocations: unknown; followup_text: string; followup_sent_at: Date;
    }>;
  });

  const all: NegativeSession[] = [];
  for (const r of unableRows)    all.push({ ...r, bucket: "agent_unable_to_do_work" });
  for (const r of failureRows)   all.push({ ...r, bucket: "failure" });
  for (const r of frustratedRows) {
    all.push({
      sessionId: r.sessionId,
      bucket: "user_frustrated",
      completedAt: r.completedAt,
      conversationId: r.conversationId,
      userId: r.userId,
      task: r.task,
      result: r.result,
      error: r.error,
      status: r.status,
      totalMs: r.totalMs,
      llmTotalMs: r.llmTotalMs,
      toolMs: r.toolMs,
      llmRetries: r.llmRetries,
      lastRetryReason: r.lastRetryReason,
      toolInvocations: r.toolInvocations,
      frustrationFollowup: { text: r.followup_text, sentAt: r.followup_sent_at },
    });
  }

  return all;
}
