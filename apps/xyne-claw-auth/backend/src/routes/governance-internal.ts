/**
 * The one door through which xyne-claw (which has no database) records governance data: runtime
 * findings and audit events. A tool_call event with a side effect is written before the response, so a
 * failed write refuses the call ("audit unavailable"); reads and findings are queued and batched.
 * claw knows the run's session id, not its org: the run row supplies org, run and conversation.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, badRequest, ok } from "../lib/http.js";
import { orgIdForUser } from "../lib/audit.js";
import {
  ACTOR_KINDS,
  GOVERNANCE_EVENT_TYPES,
  governanceQueueStats,
  queueGovernanceEvent,
  recordGovernanceEvent,
  withoutUndefined,
  type GovernanceEventInput,
} from "../lib/governance-audit.js";
import { runContextForSession } from "../lib/governance-gate.js";
import { contentScanFindingRepository } from "../repositories/governanceRepository.js";
import { createLogger } from "../logger.js";

const log = createLogger("governance-internal");
const text = (max = 500) => z.string().max(max).nullish();
const ms = z.number().int().nonnegative().nullish();
const ids = (max: number) => z.array(z.string().max(100)).max(max).optional();
const origin = { orgId: z.string().max(100).optional(), sessionId: z.string().max(200).optional(), userId: z.string().max(200).optional() };

const eventSchema = z.object({
  ...origin,
  eventType: z.enum(GOVERNANCE_EVENT_TYPES),
  occurredAt: z.coerce.date().optional(),
  actorKind: z.enum(ACTOR_KINDS).optional(),
  actorId: text(), onBehalfOfUserId: text(), actorIp: text(100), actorUserAgent: text(),
  subjectKind: text(100), subjectId: text(), contentSha256Before: text(64), contentSha256After: text(64),
  agentId: text(), runId: text(), conversationId: text(), toolCallId: text(), mcpServerId: text(), toolName: text(),
  traceId: text(64), spanId: text(32),
  decision: z.enum(["allow", "ask", "block"]).nullish(), reasonCode: text(64), reasonText: text(2000),
  policyVersion: text(64), scannerVersion: text(64), matchedRuleIds: ids(100), findingIds: ids(100),
  checkTierReached: text(32), parserMs: ms, judgeMs: ms, gateMs: ms, outcome: text(32),
  toolEffect: text(32), destinationKind: text(32), destinationHost: text(253), riskLevelAtCall: text(16),
  carriedPrivateData: z.boolean().nullish(), argumentsRedacted: z.string().max(16_384).nullish(), approvalId: text(),
  loadedVersionIds: ids(500),
  /** Force a synchronous write for an event the rule below would queue. */
  sync: z.boolean().optional(),
});
const findingSchema = z.object({
  ...origin,
  foundIn: z.enum(["static_version", "tool_result", "user_message", "subagent_result", "compaction_summary", "agent_answer"]),
  staticContentVersionId: text(), runId: text(), conversationId: text(), toolCallId: text(), chunkSha256: text(64),
  foundByCheck: z.enum(["parser", "xor_judge", "llm_judge", "detonator"]),
  verdict: z.enum(["unsure", "unverified", "suspicious", "injection"]),
  ruleId: text(100), ruleFamily: text(64), score: z.number().min(0).max(1),
  startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative(),
  redactedExcerpt: z.string().max(200), scanProfile: z.string().max(64), scannerVersion: z.string().max(64),
});
const bodySchema = z.object({ events: z.array(eventSchema).max(500).default([]), findings: z.array(findingSchema).max(500).default([]) });
type EventBody = z.infer<typeof eventSchema>;
type FindingBody = z.infer<typeof findingSchema>;

// An unclassified tool call counts as a side effect, like everywhere else in the framework.
const sideEffect = (e: EventBody): boolean => e.sync === true || (e.eventType === "tool_call" && e.toolEffect !== "read");

type Placed<T> = Omit<T, "sessionId" | "userId" | "orgId" | "runId" | "conversationId"> & { orgId: string; runId: string | null; conversationId: string | null };

/** Fills org, run and conversation from the session's run row, or the org from the user; null when neither resolves. */
async function placed<T extends { orgId?: string | undefined; sessionId?: string | undefined; userId?: string | undefined; runId?: string | null | undefined; conversationId?: string | null | undefined }>(
  row: T,
): Promise<Placed<T> | null> {
  const { sessionId, userId, ...rest } = row;
  const run = await runContextForSession(sessionId);
  const orgId = rest.orgId ?? run.orgId ?? (userId ? await orgIdForUser(userId) : undefined);
  if (!orgId) return null;
  return { ...rest, orgId, runId: rest.runId ?? run.runId ?? null, conversationId: rest.conversationId ?? run.conversationId ?? null } as Placed<T>;
}

export const governanceInternalRouter = Router();

governanceInternalRouter.post("/events", asyncHandler(async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  let unplaced = 0;
  const events: Array<GovernanceEventInput & { sync?: boolean | undefined }> = [];
  for (const e of parsed.data.events) {
    const p = await placed({ ...e, onBehalfOfUserId: e.onBehalfOfUserId ?? e.userId ?? null });
    if (p) events.push(p);
    else unplaced++;
  }
  const findings: Placed<FindingBody>[] = [];
  for (const f of parsed.data.findings) {
    const p = await placed(f);
    if (p) findings.push(p);
    else unplaced++;
  }
  if (unplaced > 0) log.warn(`[governance-internal] ${unplaced} record(s) without an org (unknown session and user) dropped`);
  const now = events.filter((e) => sideEffect(e as EventBody)).map(({ sync: _sync, ...e }) => e);
  const later = events.filter((e) => !sideEffect(e as EventBody)).map(({ sync: _sync, ...e }) => e);
  try {
    await Promise.all(now.map((e) => recordGovernanceEvent(e)));
  } catch (err) {
    log.error(`[governance-internal] ${now.length} side-effect events not written:`, err instanceof Error ? err.message : err);
    res.status(503).json({ success: false, error: "audit unavailable" });
    return;
  }
  for (const e of later) queueGovernanceEvent(e);
  if (findings.length > 0) await contentScanFindingRepository.createMany(findings.map(withoutUndefined));
  ok(res, { recorded: now.length, queued: later.length, findings: findings.length, unplaced, dropped: governanceQueueStats().dropped });
}));
