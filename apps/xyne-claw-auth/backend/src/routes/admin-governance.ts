/**
 * The governance dashboard's API, claw admins only: the tool-call feed with filters, its stats,
 * a CSV export for auditors, and the kill switches. Setting or clearing a switch takes a person:
 * a run's credential (the S2S key with a user id) is refused.
 */
import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { KILL_SCOPE_KINDS } from "xyne-claw-shared/governance";
import { governancePrisma, prisma } from "../db.js";
import { getAdminOrgScope } from "../lib/admin-org-scope.js";
import { clearKillSwitch, KILL_MODES, listKillSwitches, setKillSwitch } from "../lib/governance-kill.js";
import { asyncHandler, badRequest, forbidden, notFound, ok } from "../lib/http.js";
import { getOrgId, requireRequester } from "../middleware/agent-acl.js";
import { s2sKeyMatches } from "../middleware/require-auth.js";

const router = Router();
const DAY_MS = 24 * 60 * 60_000;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const date = (v: unknown): Date | undefined => {
  const s = str(v);
  const d = s ? new Date(s) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

/** The feed's filters as one where clause; the last 7 days of tool calls by default. */
export function eventsWhere(q: Record<string, unknown>, orgId: string | undefined): Prisma.GovernanceAuditEventWhereInput {
  const since = date(q["since"]) ?? new Date(Date.now() - 7 * DAY_MS);
  const until = date(q["until"]);
  const tool = str(q["tool"]);
  const eq = (key: string, column: keyof Prisma.GovernanceAuditEventWhereInput): Prisma.GovernanceAuditEventWhereInput => (str(q[key]) ? { [column]: str(q[key]) } : {});
  return {
    ...(orgId ? { orgId } : {}),
    eventType: str(q["eventType"]) ?? "tool_call",
    occurredAt: { gte: since, ...(until ? { lte: until } : {}) },
    ...eq("decision", "decision"),
    ...eq("risk", "riskLevelAtCall"),
    ...eq("effect", "toolEffect"),
    ...eq("outcome", "outcome"),
    ...eq("server", "mcpServerId"),
    ...eq("agent", "actorId"),
    ...eq("user", "onBehalfOfUserId"),
    ...eq("runId", "runId"),
    ...(tool ? { toolName: { contains: tool, mode: "insensitive" } } : {}),
  };
}

const SELECT = {
  id: true, occurredAt: true, orgSequence: true, orgId: true, eventType: true, actorKind: true, actorId: true, onBehalfOfUserId: true, runId: true, conversationId: true,
  toolCallId: true, mcpServerId: true, toolName: true, decision: true, reasonCode: true, reasonText: true, toolEffect: true, destinationKind: true, destinationHost: true,
  riskLevelAtCall: true, carriedPrivateData: true, outcome: true, matchedRuleIds: true, gateMs: true, judgeMs: true, subjectKind: true, subjectId: true, argumentsRedacted: true,
} as const;

router.get("/events", asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/governance/events");
  const where = eventsWhere(req.query as Record<string, unknown>, scope.orgId);
  const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50), 1), 200);
  const offset = Math.max(0, Number(req.query["offset"] ?? 0));
  const [rows, total] = await Promise.all([
    governancePrisma.governanceAuditEvent.findMany({ where, orderBy: { occurredAt: "desc" }, take: limit, skip: offset, select: SELECT }),
    governancePrisma.governanceAuditEvent.count({ where }),
  ]);
  const runIds = [...new Set(rows.map((r) => r.runId).filter((id): id is string => !!id))];
  const sessions = new Map(runIds.length > 0 ? (await prisma.agentRun.findMany({ where: { id: { in: runIds } }, select: { id: true, sessionId: true } })).map((r) => [r.id, r.sessionId]) : []);
  ok(res, { rows: rows.map((r) => ({ ...r, sessionId: r.runId ? sessions.get(r.runId) ?? null : null })), total });
}));

const CSV_COLUMNS = ["occurredAt", "orgSequence", "eventType", "actorId", "onBehalfOfUserId", "runId", "toolCallId", "mcpServerId", "toolName", "toolEffect", "destinationKind", "decision", "reasonCode", "riskLevelAtCall", "carriedPrivateData", "outcome", "gateMs", "judgeMs", "reasonText"] as const;
const csvCell = (v: unknown): string => {
  const s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get("/events.csv", asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/governance/events.csv");
  const rows = await governancePrisma.governanceAuditEvent.findMany({ where: eventsWhere(req.query as Record<string, unknown>, scope.orgId), orderBy: { occurredAt: "desc" }, take: 10_000, select: SELECT });
  const lines = [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))];
  res.type("text/csv").setHeader("Content-Disposition", `attachment; filename="governance-events-${new Date().toISOString().slice(0, 10)}.csv"`).send(lines.join("\n"));
}));

router.get("/stats", asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/governance/stats");
  const days = Math.min(Math.max(Number(req.query["days"] ?? 7), 1), 90);
  const since = new Date(Date.now() - days * DAY_MS);
  const base = { ...(scope.orgId ? { orgId: scope.orgId } : {}), occurredAt: { gte: since } };
  const calls = { ...base, eventType: "tool_call" };
  const [byDecision, highRiskByAgent, topTools, killEvents, outcomes, sample] = await Promise.all([
    governancePrisma.governanceAuditEvent.groupBy({ by: ["decision"], where: calls, _count: { _all: true } }),
    governancePrisma.governanceAuditEvent.groupBy({ by: ["actorId"], where: { ...calls, riskLevelAtCall: { in: ["elevated", "high"] } }, _count: { _all: true }, orderBy: { _count: { actorId: "desc" } }, take: 10 }),
    governancePrisma.governanceAuditEvent.groupBy({ by: ["toolName"], where: calls, _count: { _all: true }, orderBy: { _count: { toolName: "desc" } }, take: 10 }),
    governancePrisma.governanceAuditEvent.count({ where: { ...base, eventType: { in: ["kill_switch_set", "kill_switch_enforced", "kill_switch_cleared"] } } }),
    governancePrisma.governanceAuditEvent.groupBy({ by: ["outcome"], where: { ...base, eventType: "tool_outcome" }, _count: { _all: true } }),
    // Days are bucketed here rather than in SQL; 50k calls cover a week of a busy org.
    governancePrisma.governanceAuditEvent.findMany({ where: calls, select: { occurredAt: true, decision: true }, orderBy: { occurredAt: "desc" }, take: 50_000 }),
  ]);
  const perDay = new Map<string, { day: string; allow: number; ask: number; block: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    perDay.set(day, { day, allow: 0, ask: 0, block: 0 });
  }
  for (const r of sample) {
    const bucket = perDay.get(r.occurredAt.toISOString().slice(0, 10));
    if (bucket && (r.decision === "allow" || r.decision === "ask" || r.decision === "block")) bucket[r.decision]++;
  }
  ok(res, {
    days,
    byDecision: byDecision.map((d) => ({ decision: d.decision ?? "none", count: d._count._all })),
    highRiskByAgent: highRiskByAgent.map((a) => ({ agent: a.actorId ?? "unknown", count: a._count._all })),
    topTools: topTools.map((t) => ({ tool: t.toolName ?? "unknown", count: t._count._all })),
    outcomes: outcomes.map((o) => ({ outcome: o.outcome ?? "none", count: o._count._all })),
    killEvents,
    perDay: [...perDay.values()],
    sampled: sample.length === 50_000,
  });
}));

/** Only a person decides: a run's credential is refused. */
function requirePerson(req: Request): string {
  if (s2sKeyMatches(req.headers["x-s2s-key"])) throw forbidden("Only a signed-in admin can change kill switches");
  return requireRequester(req, "x-user-id required");
}

const serialise = (r: { epoch: bigint } & Record<string, unknown>) => ({ ...r, epoch: Number(r.epoch) });

router.get("/kill-switches", asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/governance/kill-switches");
  ok(res, (await listKillSwitches(scope.orgId)).map(serialise));
}));

router.post("/kill-switches", asyncHandler(async (req: Request, res: Response) => {
  const userId = requirePerson(req);
  const orgId = getOrgId(req);
  if (!orgId) throw badRequest("orgId is required");
  const { scopeKind, scopeId, mode, reason, expiresInMinutes } = req.body as { scopeKind?: string; scopeId?: string; mode?: string; reason?: string; expiresInMinutes?: number };
  if (!scopeKind || !(KILL_SCOPE_KINDS as readonly string[]).includes(scopeKind)) throw badRequest(`scopeKind must be one of ${KILL_SCOPE_KINDS.join(", ")}`);
  if (!mode || !(KILL_MODES as readonly string[]).includes(mode)) throw badRequest(`mode must be one of ${KILL_MODES.join(", ")}`);
  const id = scopeKind === "platform" ? "*" : str(scopeId);
  if (!id) throw badRequest("scopeId is required");
  if (!str(reason)) throw badRequest("a reason is required");
  const minutes = Number(expiresInMinutes);
  const expiresAt = Number.isFinite(minutes) && minutes > 0 ? new Date(Date.now() + Math.min(minutes, 7 * 24 * 60) * 60_000) : undefined;
  const result = await setKillSwitch({ orgId, scopeKind: scopeKind as (typeof KILL_SCOPE_KINDS)[number], scopeId: id, mode: mode as (typeof KILL_MODES)[number], reason: reason!, actor: { kind: "admin", userId }, expiresAt });
  ok(res, result);
}));

router.post("/kill-switches/:id/clear", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const userId = requirePerson(req);
  const { reason } = req.body as { reason?: string };
  if (!str(reason)) throw badRequest("a reason is required");
  const result = await clearKillSwitch(req.params.id, { kind: "admin", userId }, reason!);
  if (!result) throw notFound("Kill switch not found or already cleared");
  ok(res, result);
}));

export { router as adminGovernanceRouter };
