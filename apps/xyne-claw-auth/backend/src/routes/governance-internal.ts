/**
 * The one door through which xyne-claw (which has no database) records governance data: runtime
 * findings and audit events. A tool_call event with a side effect is written before the response, so a
 * failed write refuses the call ("audit unavailable"); reads and findings are queued and batched.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, badRequest, ok } from "../lib/http.js";
import {
  ACTOR_KINDS,
  GOVERNANCE_EVENT_TYPES,
  governanceQueueStats,
  queueGovernanceEvent,
  recordGovernanceEvent,
  withoutUndefined,
} from "../lib/governance-audit.js";
import { contentScanFindingRepository } from "../repositories/governanceRepository.js";
import { createLogger } from "../logger.js";

const log = createLogger("governance-internal");
const text = (max = 500) => z.string().max(max).nullish();
const ms = z.number().int().nonnegative().nullish();
const ids = (max: number) => z.array(z.string().max(100)).max(max).optional();

const eventSchema = z.object({
  orgId: z.string().min(1).max(100),
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
  orgId: z.string().min(1).max(100),
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

// An unclassified tool call counts as a side effect, like everywhere else in the framework.
const sideEffect = (e: EventBody): boolean => e.sync === true || (e.eventType === "tool_call" && e.toolEffect !== "read");

export const governanceInternalRouter = Router();

governanceInternalRouter.post("/events", asyncHandler(async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  const { events, findings } = parsed.data;
  const now = events.filter(sideEffect).map(({ sync: _sync, ...e }) => e);
  const later = events.filter((e) => !sideEffect(e)).map(({ sync: _sync, ...e }) => e);
  try {
    await Promise.all(now.map((e) => recordGovernanceEvent(e)));
  } catch (err) {
    log.error(`[governance-internal] ${now.length} side-effect events not written:`, err instanceof Error ? err.message : err);
    res.status(503).json({ success: false, error: "audit unavailable" });
    return;
  }
  for (const e of later) queueGovernanceEvent(e);
  if (findings.length > 0) await contentScanFindingRepository.createMany(findings.map(withoutUndefined));
  ok(res, { recorded: now.length, queued: later.length, findings: findings.length, dropped: governanceQueueStats().dropped });
}));
