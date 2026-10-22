/**
 * The governance dashboard's API, claw admins only: the tool-call feed with filters, its stats,
 * a CSV export for auditors, and the kill switches. Setting or clearing a switch takes a person:
 * a run's credential (the S2S key with a user id) is refused.
 */
import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { KILL_SCOPE_KINDS, parseComponentModes } from "xyne-claw-shared/governance";
import { CONFIG } from "../config.js";
import { governancePrisma, prisma } from "../db.js";
import { getAdminOrgScope } from "../lib/admin-org-scope.js";
import { clearKillSwitch, currentKillSnapshot, KILL_MODES, listKillSwitches, setKillSwitch } from "../lib/governance-kill.js";
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
  riskLevelAtCall: true, carriedPrivateData: true, outcome: true, matchedRuleIds: true, gateMs: true, judgeMs: true, subjectKind: true, subjectId: true, argumentsRedacted: true, scannerVersion: true,
} as const;

/** Display names for the ids the rows carry: agents by slug, people by id, skills by subject id. */
async function namesFor(agentSlugs: Iterable<string | null>, userIds: Iterable<string | null>, orgId: string | undefined, subjectIds: Iterable<string | null> = []): Promise<{ agents: Record<string, string>; users: Record<string, { name: string; email: string }>; skills: Record<string, { slug: string; name: string }> }> {
  const slugs = [...new Set([...agentSlugs].filter((s): s is string => !!s))];
  const ids = [...new Set([...userIds].filter((s): s is string => !!s))];
  const skillIds = [...new Set([...subjectIds].flatMap((s) => (s?.startsWith("skill:") ? [s.slice(6)] : [])))];
  const [agents, users, skills] = await Promise.all([
    slugs.length > 0 ? prisma.agent.findMany({ where: { slug: { in: slugs }, ...(orgId ? { orgId } : {}) }, select: { slug: true, name: true } }) : [],
    ids.length > 0 ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [],
    skillIds.length > 0 ? prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, slug: true, name: true } }) : [],
  ]);
  return {
    agents: Object.fromEntries(agents.map((a) => [a.slug, a.name])),
    users: Object.fromEntries(users.map((u) => [u.id, { name: u.name, email: u.email }])),
    skills: Object.fromEntries(skills.map((s) => [s.id, { slug: s.slug, name: s.name }])),
  };
}

type CriticRow = { toolCallId: string | null; decision: string | null; reasonCode: string | null; reasonText: string | null; matchedRuleIds: string[]; judgeMs: number | null; occurredAt: Date };

/** In shadow the critic answers after the call ran and its verdict is its own event; the feed joins it to the call by id. */
export async function criticsFor(rows: ReadonlyArray<{ eventType: string; toolCallId: string | null; occurredAt: Date }>, orgId: string | undefined): Promise<Map<string, CriticRow>> {
  const out = new Map<string, CriticRow>();
  const calls = rows.filter((r) => r.eventType === "tool_call" && r.toolCallId);
  if (calls.length === 0) return out;
  const times = calls.map((r) => r.occurredAt.getTime());
  const verdicts: CriticRow[] = await governancePrisma.governanceAuditEvent.findMany({
    where: { ...(orgId ? { orgId } : {}), eventType: "critic_verdict", toolCallId: { in: calls.map((r) => r.toolCallId!) }, occurredAt: { gte: new Date(Math.min(...times) - 60_000), lte: new Date(Math.max(...times) + 10 * 60_000) } },
    orderBy: { occurredAt: "asc" },
    select: { toolCallId: true, decision: true, reasonCode: true, reasonText: true, matchedRuleIds: true, judgeMs: true, occurredAt: true },
  });
  for (const v of verdicts) if (v.toolCallId) out.set(v.toolCallId, v);
  return out;
}

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
  const [sessions, names, critics] = await Promise.all([
    runIds.length > 0 ? prisma.agentRun.findMany({ where: { id: { in: runIds } }, select: { id: true, sessionId: true } }).then((runs) => new Map(runs.map((r) => [r.id, r.sessionId]))) : new Map<string, string>(),
    namesFor(rows.map((r) => (r.actorKind === "agent" ? r.actorId : null)), rows.flatMap((r) => [r.onBehalfOfUserId, r.actorKind === "agent" ? null : r.actorId]), scope.orgId, rows.map((r) => r.subjectId)),
    criticsFor(rows, scope.orgId),
  ]);
  ok(res, { rows: rows.map((r) => ({ ...r, sessionId: r.runId ? sessions.get(r.runId) ?? null : null, critic: r.toolCallId ? critics.get(r.toolCallId) ?? null : null })), total, names });
}));

/** The values the feed's filters can take in a window, with counts and names, so a filter offers what exists. */
router.get("/facets", asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/governance/facets");
  const where = { ...(scope.orgId ? { orgId: scope.orgId } : {}), eventType: "tool_call", occurredAt: { gte: date(req.query["since"]) ?? new Date(Date.now() - 7 * DAY_MS) } };
  const [agents, users, tools, servers] = await Promise.all([
    governancePrisma.governanceAuditEvent.groupBy({ by: ["actorId"], where, _count: { _all: true }, orderBy: { _count: { actorId: "desc" } }, take: 200 }),
    governancePrisma.governanceAuditEvent.groupBy({ by: ["onBehalfOfUserId"], where, _count: { _all: true }, orderBy: { _count: { onBehalfOfUserId: "desc" } }, take: 200 }),
    governancePrisma.governanceAuditEvent.groupBy({ by: ["toolName"], where, _count: { _all: true }, orderBy: { _count: { toolName: "desc" } }, take: 200 }),
    governancePrisma.governanceAuditEvent.groupBy({ by: ["mcpServerId"], where, _count: { _all: true }, orderBy: { _count: { mcpServerId: "desc" } }, take: 100 }),
  ]);
  const names = await namesFor(agents.map((a) => a.actorId), users.map((u) => u.onBehalfOfUserId), scope.orgId);
  ok(res, {
    agents: agents.flatMap((a) => (a.actorId ? [{ slug: a.actorId, name: names.agents[a.actorId] ?? null, count: a._count._all }] : [])),
    users: users.flatMap((u) => (u.onBehalfOfUserId ? [{ id: u.onBehalfOfUserId, name: names.users[u.onBehalfOfUserId]?.name ?? null, email: names.users[u.onBehalfOfUserId]?.email ?? null, count: u._count._all }] : [])),
    tools: tools.flatMap((t) => (t.toolName ? [{ name: t.toolName, count: t._count._all }] : [])),
    servers: servers.flatMap((s) => (s.mcpServerId ? [{ id: s.mcpServerId, count: s._count._all }] : [])),
  });
}));

/** Each service's component modes and kill snapshot, so the page can say whether a switch will act. */
router.get("/config", asyncHandler(async (_req: Request, res: Response) => {
  const snap = currentKillSnapshot();
  const clawAuth = { modes: parseComponentModes(process.env), kill: { epoch: snap.epoch, ageMs: Date.now() - snap.takenAtMs, switches: snap.switches.length } };
  let claw: unknown = null;
  try {
    const r = await fetch(`${CONFIG.xyneClawUrl.replace(/\/+$/, "")}/governance/modes`, { headers: { "x-s2s-key": CONFIG.xyneClawS2sKey }, signal: AbortSignal.timeout(1_500) });
    if (r.ok) claw = await r.json();
  } catch {
    // claw unreachable: the page says so.
  }
  ok(res, { clawAuth, claw });
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
