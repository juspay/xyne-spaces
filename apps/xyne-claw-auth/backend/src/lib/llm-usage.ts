/**
 * Per-call LLM usage ledger (llm_call_usage): ingest from xyne-claw, pricing,
 * and the aggregates behind the dashboard's AI control panel. Tokens are the
 * provider's own counts; nothing here estimates.
 */

import type { Request } from "express";
import { Prisma, type LlmModelPrice } from "@prisma/client";
import { prisma } from "../db.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { runAnalytics } from "./metrics-sql.js";
import { writeAuditLog } from "./audit.js";
import { parseTz } from "./metrics-core.js";
import { createLogger } from "../logger.js";

const log = createLogger("llm-usage");

const BILLING_BASES = ["platform", "api_key", "subscription"] as const;
const OUTCOMES = new Set(["ok", "error", "aborted"]);
const MAX_BATCH = 500;
const MAX_RANGE_DAYS = 366;
const MAX_GROUPS = 20_000;
const MAX_SESSION_CALLS = 5_000;

// ── Ingest ────────────────────────────────────────────────────────────────────

/** Wire shape posted by xyne-claw (src/llm-usage.ts). */
export interface LlmCallEventInput {
  id: string;
  runId?: string;
  userId?: string;
  agentSlug?: string;
  conversationId?: string;
  ticketId?: string;
  /** Only for calls with no run or user (agent-level helpers). */
  orgId?: string;
  purpose: string;
  subagent?: string;
  outcome: string;
  provider: string;
  billing: string;
  model: string;
  servedModel?: string;
  serviceTier?: string;
  usageReported: boolean;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  toolNames?: string[];
  responseId?: string;
  startedAt: string;
  durationMs: number;
}

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
const count = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/** Returns null for a malformed event; ingest drops it rather than store wrong numbers. */
export function parseLlmCallEvent(raw: unknown): LlmCallEventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const id = str(e["id"], 64);
  const purpose = str(e["purpose"], 40);
  const outcome = str(e["outcome"], 16);
  const provider = str(e["provider"], 40);
  const billing = str(e["billing"], 16);
  const model = str(e["model"]);
  const startedAt = str(e["startedAt"], 40);
  const tokens = [count(e["input"]), count(e["output"]), count(e["cacheRead"]), count(e["cacheWrite"])];
  const durationMs = count(e["durationMs"]);
  if (!id || !purpose || !outcome || !OUTCOMES.has(outcome) || !provider || !model || !startedAt) return null;
  if (!billing || !(BILLING_BASES as readonly string[]).includes(billing)) return null;
  if (tokens.some((t) => t === null) || durationMs === null || typeof e["usageReported"] !== "boolean") return null;
  if (Number.isNaN(Date.parse(startedAt))) return null;
  const [input, output, cacheRead, cacheWrite] = tokens as number[];
  const toolNames = Array.isArray(e["toolNames"])
    ? (e["toolNames"] as unknown[]).map((t) => str(t, 120)).filter((t): t is string => !!t).slice(0, 64)
    : [];
  const opt = (k: string, max?: number) => {
    const v = str(e[k], max);
    return v === undefined ? {} : { [k]: v };
  };
  return {
    id, purpose, outcome, provider, billing, model, startedAt, durationMs,
    usageReported: e["usageReported"] as boolean,
    input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, toolNames,
    ...opt("runId", 100), ...opt("userId", 100), ...opt("orgId", 100), ...opt("agentSlug", 100), ...opt("conversationId", 200),
    ...opt("ticketId", 100), ...opt("subagent", 100), ...opt("servedModel"), ...opt("serviceTier", 20), ...opt("responseId"),
  } as LlmCallEventInput;
}

/**
 * Stores a batch. Org, user, agent, conversation and trigger come from the run
 * row when the call belongs to one; otherwise the org is the user's, then the
 * agent's (unique per org slug only when unambiguous). Calls with no resolvable
 * org are dropped and counted.
 */
export async function ingestLlmCalls(raw: unknown[]): Promise<{ inserted: number; dropped: number }> {
  const events = raw.slice(0, MAX_BATCH).map(parseLlmCallEvent);
  let dropped = raw.length - events.length + events.filter((e) => !e).length;
  const valid = events.filter((e): e is LlmCallEventInput => !!e);
  if (valid.length === 0) return { inserted: 0, dropped };

  const runIds = [...new Set(valid.map((e) => e.runId).filter((v): v is string => !!v))];
  const runs = runIds.length
    ? await prisma.agentRun.findMany({
        where: { sessionId: { in: runIds } },
        select: { sessionId: true, orgId: true, userId: true, agentSlug: true, conversationId: true, triggerSource: true },
      })
    : [];
  const runById = new Map(runs.map((r) => [r.sessionId, r]));
  const userIds = [...new Set(valid.filter((e) => !(e.runId && runById.has(e.runId))).map((e) => e.userId).filter((v): v is string => !!v))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, orgId: true } }) : [];
  const orgByUser = new Map(users.map((u) => [u.id, u.orgId]));
  const slugs = [...new Set(valid.filter((e) => !(e.runId && runById.has(e.runId)) && !(e.userId && orgByUser.has(e.userId)) && !e.orgId).map((e) => e.agentSlug).filter((v): v is string => !!v))];
  const agents = slugs.length ? await prisma.agent.findMany({ where: { slug: { in: slugs } }, select: { slug: true, orgId: true } }) : [];
  const orgsBySlug = new Map<string, Set<string>>();
  for (const a of agents) orgsBySlug.set(a.slug, (orgsBySlug.get(a.slug) ?? new Set()).add(a.orgId));
  const prices = await loadPrices();

  const rows: Prisma.LlmCallUsageCreateManyInput[] = [];
  for (const e of valid) {
    const run = e.runId ? runById.get(e.runId) : undefined;
    const slugOrgs = e.agentSlug ? orgsBySlug.get(e.agentSlug) : undefined;
    const orgId = run?.orgId ?? (e.userId ? orgByUser.get(e.userId) : undefined) ?? e.orgId ?? (slugOrgs?.size === 1 ? [...slugOrgs][0] : undefined);
    if (!orgId) {
      dropped++;
      continue;
    }
    const startedAt = new Date(e.startedAt);
    const serviceTier = e.serviceTier ?? "standard";
    const { costUsd, priceId, slabOverPromptTokens } = priceCall(prices, { ...e, serviceTier, startedAt });
    rows.push({
      id: e.id,
      orgId,
      userId: run?.userId ?? e.userId ?? null,
      agentSlug: run?.agentSlug ?? e.agentSlug ?? null,
      runId: e.runId ?? null,
      conversationId: run?.conversationId ?? e.conversationId ?? null,
      ticketId: e.ticketId ?? null,
      triggerSource: run?.triggerSource ?? null,
      callPurpose: e.purpose,
      subagentName: e.subagent ?? null,
      callOutcome: e.outcome,
      provider: e.provider,
      billingBasis: e.billing,
      model: e.model,
      servedModel: e.servedModel ?? null,
      serviceTier,
      usageReported: e.usageReported,
      inputTokens: e.input,
      outputTokens: e.output,
      cacheReadTokens: e.cacheRead,
      cacheWriteTokens: e.cacheWrite,
      costUsd,
      priceId,
      slabOverPromptTokens,
      toolNames: e.toolNames ?? [],
      responseId: e.responseId ?? null,
      startedAt,
      durationMs: e.durationMs,
    });
  }
  if (dropped > 0) log.warn(`dropped ${dropped} call(s) with no valid shape or org`);
  if (rows.length === 0) return { inserted: 0, dropped };
  const { count: inserted } = await prisma.llmCallUsage.createMany({ data: rows, skipDuplicates: true });
  return { inserted, dropped };
}

// ── Pricing ───────────────────────────────────────────────────────────────────

const RATE_KEYS = ["inputPerMTok", "outputPerMTok", "cacheReadPerMTok", "cacheWritePerMTok"] as const;
/** One entry of llm_model_prices.slabs; rates are decimal strings. */
type PriceSlab = Record<(typeof RATE_KEYS)[number], string> & { overPromptTokens: number };
const slabsOf = (p: LlmModelPrice): PriceSlab[] => (Array.isArray(p.slabs) ? (p.slabs as unknown as PriceSlab[]) : []);

/** Read per batch, never cached: a cache would keep other servers pricing new calls at a changed rate. */
function loadPrices(): Promise<LlmModelPrice[]> {
  return prisma.llmModelPrice.findMany({ orderBy: { effectiveFrom: "desc" } });
}

interface PricedCall {
  provider: string;
  billing: string;
  model: string;
  servedModel?: string | undefined;
  serviceTier: string;
  startedAt: Date;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The newest row in effect at the call's start, matching the requested model first, then the served one. */
export function pickPrice(prices: readonly LlmModelPrice[], c: Pick<PricedCall, "provider" | "model" | "servedModel" | "serviceTier" | "startedAt">): LlmModelPrice | undefined {
  const inEffect = (model: string) =>
    prices
      .filter((p) => p.provider === c.provider && p.model === model && p.serviceTier === c.serviceTier && p.effectiveFrom <= c.startedAt)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  return inEffect(c.model) ?? (c.servedModel ? inEffect(c.servedModel) : undefined);
}

/**
 * Subscription calls are never priced per token. An unpriced platform call costs
 * 0 (our own hosted models); an unpriced API call stays NULL so it shows as unpriced.
 */
export function priceCall(prices: readonly LlmModelPrice[], c: PricedCall): { costUsd: Prisma.Decimal | null; priceId: string | null; slabOverPromptTokens: number | null } {
  if (c.billing === "subscription") return { costUsd: null, priceId: null, slabOverPromptTokens: null };
  const p = pickPrice(prices, c);
  if (!p) return { costUsd: c.billing === "platform" ? new Prisma.Decimal(0) : null, priceId: null, slabOverPromptTokens: null };
  // The whole request, output included, pays the highest slab its prompt is over.
  const prompt = c.input + c.cacheRead + c.cacheWrite;
  const slab = slabsOf(p).filter((s) => prompt > s.overPromptTokens).sort((a, b) => b.overPromptTokens - a.overPromptTokens)[0];
  const r = slab ?? p;
  const micro = new Prisma.Decimal(c.input).mul(r.inputPerMTok)
    .add(new Prisma.Decimal(c.output).mul(r.outputPerMTok))
    .add(new Prisma.Decimal(c.cacheRead).mul(r.cacheReadPerMTok))
    .add(new Prisma.Decimal(c.cacheWrite).mul(r.cacheWritePerMTok));
  return { costUsd: micro.div(1_000_000).toDecimalPlaces(8), priceId: p.id, slabOverPromptTokens: slab?.overPromptTokens ?? null };
}

export interface PriceInput {
  provider: string;
  model: string;
  serviceTier?: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  effectiveFrom?: string;
  slabs: Array<Rates & { overPromptTokens: number }>;
}

type Rates = Record<(typeof RATE_KEYS)[number], number>;

function parseRates(b: Record<string, unknown>, at = ""): Rates | { error: string } {
  const out = {} as Rates;
  for (const k of RATE_KEYS) {
    const v = b[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000) return { error: `${at}${k} must be a non-negative number` };
    out[k] = v;
  }
  return out;
}

/** Default effectiveFrom: the epoch, so a first price also covers calls made before it was entered. */
export function parsePriceInput(body: unknown): PriceInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const provider = str(b["provider"], 40);
  const model = str(b["model"]);
  if (!provider || !model) return { error: "provider and model are required" };
  const rates = parseRates(b);
  if ("error" in rates) return rates;
  const effectiveFrom = str(b["effectiveFrom"], 40);
  if (effectiveFrom && Number.isNaN(Date.parse(effectiveFrom))) return { error: "effectiveFrom must be an ISO date" };
  const rawSlabs = b["slabs"] ?? [];
  if (!Array.isArray(rawSlabs) || rawSlabs.length > 10) return { error: "slabs must be a list of at most 10" };
  const slabs: PriceInput["slabs"] = [];
  for (const [i, raw] of rawSlabs.entries()) {
    const sb = (raw ?? {}) as Record<string, unknown>;
    const over = sb["overPromptTokens"];
    if (typeof over !== "number" || !Number.isInteger(over) || over < 1 || over > 100_000_000) return { error: `slabs[${i}].overPromptTokens must be a whole number of tokens, 1 or more` };
    if (slabs.some((x) => x.overPromptTokens === over)) return { error: `two slabs start over ${over} tokens` };
    const r = parseRates(sb, `slabs[${i}].`);
    if ("error" in r) return r;
    slabs.push({ overPromptTokens: over, ...r });
  }
  return {
    provider, model, serviceTier: str(b["serviceTier"], 20) ?? "standard", ...rates,
    ...(effectiveFrom ? { effectiveFrom } : {}),
    slabs: slabs.sort((x, y) => x.overPromptTokens - y.overPromptTokens),
  };
}

export async function upsertPrice(input: PriceInput, userId: string): Promise<{ price: LlmModelPrice; repriced: number }> {
  const key = { provider: input.provider, model: input.model, serviceTier: input.serviceTier ?? "standard", effectiveFrom: new Date(input.effectiveFrom ?? 0) };
  const rates = {
    inputPerMTok: input.inputPerMTok, outputPerMTok: input.outputPerMTok,
    cacheReadPerMTok: input.cacheReadPerMTok, cacheWritePerMTok: input.cacheWritePerMTok, updatedByUserId: userId,
    slabs: input.slabs.map((sl): PriceSlab => ({
      overPromptTokens: sl.overPromptTokens,
      ...(Object.fromEntries(RATE_KEYS.map((k) => [k, new Prisma.Decimal(sl[k]).toDecimalPlaces(6).toString()])) as Record<(typeof RATE_KEYS)[number], string>),
    })),
  };
  const where = { provider_model_serviceTier_effectiveFrom: key };
  const before = await prisma.llmModelPrice.findUnique({ where });
  const price = await prisma.llmModelPrice.upsert({ where, create: { ...key, ...rates }, update: rates });
  const repriced = await repriceCalls(key);
  await auditPrice(before ? "LLM_PRICE_UPDATED" : "LLM_PRICE_CREATED", userId, price, before, price, repriced);
  return { price, repriced };
}

export async function deletePrice(id: string, userId: string): Promise<number | null> {
  const price = await prisma.llmModelPrice.findUnique({ where: { id } });
  if (!price) return null;
  await prisma.llmModelPrice.delete({ where: { id } });
  const repriced = await repriceCalls(price);
  await auditPrice("LLM_PRICE_DELETED", userId, price, price, null, repriced);
  return repriced;
}

const PRICE_AUDIT_EVENTS = ["LLM_PRICE_CREATED", "LLM_PRICE_UPDATED", "LLM_PRICE_DELETED"] as const;
type PriceAuditEvent = (typeof PRICE_AUDIT_EVENTS)[number];
const rateText = (r: Pick<LlmModelPrice, (typeof RATE_KEYS)[number]>) => Object.fromEntries(RATE_KEYS.map((k) => [k, r[k].toString()]));
const rateSnapshot = (p: LlmModelPrice | null) => p && { ...rateText(p), slabs: slabsOf(p) };

function auditPrice(eventType: PriceAuditEvent, userId: string, p: LlmModelPrice, before: LlmModelPrice | null, after: LlmModelPrice | null, repriced: number): Promise<void> {
  const verb = { LLM_PRICE_CREATED: "Added", LLM_PRICE_UPDATED: "Changed", LLM_PRICE_DELETED: "Deleted" }[eventType];
  return writeAuditLog({
    actorUserId: userId, eventType, targetId: p.id,
    description: `${verb} the price of ${p.provider}/${p.model}`,
    metadata: { provider: p.provider, model: p.model, serviceTier: p.serviceTier, effectiveFrom: p.effectiveFrom.toISOString(), before: rateSnapshot(before), after: rateSnapshot(after), repricedCalls: repriced },
  });
}

export async function listPriceHistory(limit = 100) {
  const logs = await prisma.agentAuditLog.findMany({ where: { eventType: { in: [...PRICE_AUDIT_EVENTS] } }, orderBy: { createdAt: "desc" }, take: limit });
  const ids = [...new Set(logs.map((l) => l.actorUserId).filter((id): id is string => !!id))];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]));
  return logs.map((l) => {
    const actor = l.actorUserId ? actors.get(l.actorUserId) : undefined;
    return { id: l.id, eventType: l.eventType, createdAt: l.createdAt, actor: actor ? { name: actor.name || actor.email, email: actor.email } : null, ...(l.metadata as Record<string, unknown> | null) };
  });
}

/** Recomputes stored cost for every call a price row for this model can apply to. */
async function repriceCalls(key: { provider: string; model: string; serviceTier: string }): Promise<number> {
  const prices = await loadPrices();
  const where: Prisma.LlmCallUsageWhereInput = {
    provider: key.provider,
    serviceTier: key.serviceTier,
    OR: [{ model: key.model }, { servedModel: key.model }],
  };
  let cursor: string | undefined;
  let changed = 0;
  for (;;) {
    const batch = await prisma.llmCallUsage.findMany({
      where,
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;
    const updates = batch.flatMap((c) => {
      const next = priceCall(prices, {
        provider: c.provider, billing: c.billingBasis, model: c.model, servedModel: c.servedModel ?? undefined,
        serviceTier: c.serviceTier, startedAt: c.startedAt,
        input: c.inputTokens, output: c.outputTokens, cacheRead: c.cacheReadTokens, cacheWrite: c.cacheWriteTokens,
      });
      const same = next.priceId === c.priceId && next.slabOverPromptTokens === c.slabOverPromptTokens && (next.costUsd === null ? c.costUsd === null : c.costUsd !== null && next.costUsd.equals(c.costUsd));
      return same ? [] : [prisma.llmCallUsage.update({ where: { id: c.id }, data: next })];
    });
    for (let i = 0; i < updates.length; i += 200) await prisma.$transaction(updates.slice(i, i + 200));
    changed += updates.length;
  }
  return changed;
}

// ── Query parsing and scope ───────────────────────────────────────────────────

export interface UsageQuery {
  orgId: string;
  /** The viewer's Spaces workspace (verified by requireAuth), for picking each person's Spaces identity. */
  workspaceId?: string | undefined;
  requesterId: string;
  isAdmin: boolean;
  tz: string;
  from: string;
  to: string;
  start: Date;
  end: Date;
  /** Same length, immediately before. */
  previous: { start: Date; end: Date };
  agents: string[];
  users: string[];
  models: string[];
  providers: string[];
  tickets: string[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant of local midnight on `day` in `tz`. */
export function zonedDayStart(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(first, tz);
  // The estimates differ only across a DST change, where midnight itself may not exist.
  const onDay = [Math.min(first, second), Math.max(first, second)].find((t) => localDay(new Date(t), tz) === day);
  return new Date(onDay ?? second);
}

function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, 200);

export function parseRange(q: Request["query"], tz: string, now = new Date()): { from: string; to: string } | { error: string } {
  const today = localDay(now, tz);
  const to = typeof q["to"] === "string" && DAY_RE.test(q["to"]) ? q["to"] : today;
  const from = typeof q["from"] === "string" && DAY_RE.test(q["from"]) ? q["from"] : addDays(to, -29);
  if (from > to) return { error: "from must be on or before to" };
  if (dayList(from, to).length > MAX_RANGE_DAYS) return { error: `range is limited to ${MAX_RANGE_DAYS} days` };
  return { from, to };
}

/** Admins (claw admin, or org owner/admin) see their whole org; everyone else only their own calls. */
export async function resolveUsageQuery(req: Request): Promise<UsageQuery> {
  const requesterId = String(req.headers["x-user-id"] ?? "");
  if (!requesterId) throw new UsageError(401, "x-user-id header is required");
  const user = await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } });
  if (!user?.orgId) throw new UsageError(400, "orgId is required");
  const orgId = user.orgId;
  const isAdmin = (await isClawAdmin(requesterId))
    || !!(await prisma.orgMember.findFirst({ where: { userId: requesterId, orgId, leftAt: null, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } }));
  const tz = parseTz(req);
  const range = parseRange(req.query, tz);
  if ("error" in range) throw new UsageError(400, range.error);
  const start = zonedDayStart(range.from, tz);
  const end = zonedDayStart(addDays(range.to, 1), tz);
  const days = dayList(range.from, range.to).length;
  const previous = { start: zonedDayStart(addDays(range.from, -days), tz), end: start };

  const users = isAdmin ? list(req.query["users"]) : [requesterId];
  const workspaceId = typeof req.headers["x-spaces-workspace-id"] === "string" ? req.headers["x-spaces-workspace-id"] : undefined;
  return {
    orgId, workspaceId, requesterId, isAdmin, tz, from: range.from, to: range.to, start, end, previous,
    agents: list(req.query["agents"]), users, models: list(req.query["models"]), providers: list(req.query["providers"]),
    tickets: list(req.query["tickets"]),
  };
}

export class UsageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// ── SQL ───────────────────────────────────────────────────────────────────────

const any = (col: Prisma.Sql, values: string[]): Prisma.Sql =>
  values.length > 0 ? Prisma.sql`AND ${col} = ANY(${values}::text[])` : Prisma.empty;

/** Every filter except the time window, on alias u. */
function filterSql(q: UsageQuery): Prisma.Sql {
  return Prisma.sql`u."orgId" = ${q.orgId}
    ${any(Prisma.sql`u."agentSlug"`, q.agents)} ${any(Prisma.sql`u."userId"`, q.users)} ${any(Prisma.sql`u."model"`, q.models)}
    ${any(Prisma.sql`u."provider"`, q.providers)} ${any(Prisma.sql`u."ticketId"`, q.tickets)}`;
}

const windowSql = (w: { start: Date; end: Date }): Prisma.Sql =>
  Prisma.sql`u."startedAt" >= ${w.start} AND u."startedAt" < ${w.end}`;

const TOTALS = Prisma.sql`
  COALESCE(SUM(u."costUsd"), 0)::float8 AS "costUsd",
  COALESCE(SUM(u."inputTokens"), 0)::float8 AS "inputTokens",
  COALESCE(SUM(u."outputTokens"), 0)::float8 AS "outputTokens",
  COALESCE(SUM(u."cacheReadTokens"), 0)::float8 AS "cacheReadTokens",
  COALESCE(SUM(u."cacheWriteTokens"), 0)::float8 AS "cacheWriteTokens",
  COUNT(*)::int AS "calls",
  COUNT(DISTINCT u."runId")::int AS "runs",
  COUNT(DISTINCT u."conversationId")::int AS "sessions",
  COUNT(DISTINCT u."userId")::int AS "users",
  COUNT(DISTINCT u."agentSlug")::int AS "agents",
  COUNT(*) FILTER (WHERE NOT u."usageReported")::int AS "callsWithoutUsage",
  COUNT(*) FILTER (WHERE u."costUsd" IS NULL AND u."billingBasis" = 'api_key')::int AS "unpricedCalls"`;

export interface UsageTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  calls: number;
  runs: number;
  sessions: number;
  users: number;
  agents: number;
  callsWithoutUsage: number;
  unpricedCalls: number;
}

type TotalsRow = Omit<UsageTotals, "totalTokens">;
const withTotal = <T extends TotalsRow>(r: T): T & { totalTokens: number } => ({
  ...r,
  costUsd: Math.round(r.costUsd * 1e8) / 1e8,
  totalTokens: r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens,
});

const EMPTY: TotalsRow = {
  costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  calls: 0, runs: 0, sessions: 0, users: 0, agents: 0, callsWithoutUsage: 0, unpricedCalls: 0,
};

async function totals(q: UsageQuery, w: { start: Date; end: Date }): Promise<UsageTotals> {
  const [row] = await runAnalytics<TotalsRow>(Prisma.sql`SELECT ${TOTALS} FROM llm_call_usage u WHERE ${filterSql(q)} AND ${windowSql(w)}`);
  return withTotal(row ?? EMPTY);
}

export type GroupBy = "agent" | "user" | "model" | "provider" | "ticket" | "session" | "pr";
const GROUP_BYS: readonly GroupBy[] = ["agent", "user", "model", "provider", "ticket", "session", "pr"];

const GROUP_KEY: Record<Exclude<GroupBy, "pr">, Prisma.Sql> = {
  agent: Prisma.sql`COALESCE(u."agentSlug", '')`,
  user: Prisma.sql`COALESCE(u."userId", '')`,
  model: Prisma.sql`u."model"`,
  provider: Prisma.sql`u."provider"`,
  ticket: Prisma.sql`COALESCE(u."ticketId", '')`,
  session: Prisma.sql`COALESCE(u."conversationId", '')`,
};

export function parseGroupBy(raw: unknown, fallback: GroupBy): GroupBy {
  return typeof raw === "string" && (GROUP_BYS as readonly string[]).includes(raw) ? (raw as GroupBy) : fallback;
}

export interface RateGroup {
  provider: string;
  model: string;
  /** 0 for the base rates. */
  overPromptTokens: number;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

export interface UsageSummary {
  scope: { level: "org" | "own"; isAdmin: boolean };
  range: { from: string; to: string };
  totals: UsageTotals;
  previous: UsageTotals;
  byBilling: Array<UsageTotals & { key: string }>;
  /** Priced tokens grouped by the rates they were charged at (price row or slab), plus the calls with no price row (subscription, unpriced API key or platform model). */
  costSplit: { rates: RateGroup[]; uncostedCalls: number; uncostedTokens: number };
}

async function rateGroups(where: Prisma.Sql): Promise<RateGroup[]> {
  const groups = await runAnalytics<Omit<RateGroup, "provider" | "model" | (typeof RATE_KEYS)[number]> & { priceId: string }>(Prisma.sql`
    SELECT u."priceId", COALESCE(u."slabOverPromptTokens", 0)::int AS "overPromptTokens",
           SUM(u."inputTokens")::float8 AS "inputTokens", SUM(u."outputTokens")::float8 AS "outputTokens",
           SUM(u."cacheReadTokens")::float8 AS "cacheReadTokens", SUM(u."cacheWriteTokens")::float8 AS "cacheWriteTokens",
           COUNT(*)::int AS calls
    FROM llm_call_usage u WHERE ${where} AND u."priceId" IS NOT NULL GROUP BY 1, 2`);
  const prices = new Map((await prisma.llmModelPrice.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.priceId))] } } })).map((p) => [p.id, p]));
  return groups.flatMap(({ priceId, ...g }) => {
    const p = prices.get(priceId);
    if (!p) return [];
    const r = slabsOf(p).find((s) => s.overPromptTokens === g.overPromptTokens) ?? p;
    return [{ provider: p.provider, model: p.model, ...g, ...(Object.fromEntries(RATE_KEYS.map((k) => [k, Number(r[k])])) as Record<(typeof RATE_KEYS)[number], number>) }];
  }).sort((a, b) => a.model.localeCompare(b.model) || a.overPromptTokens - b.overPromptTokens);
}

export async function fetchUsageSummary(q: UsageQuery): Promise<UsageSummary> {
  const where = Prisma.sql`${filterSql(q)} AND ${windowSql(q)}`;
  const [current, previous, rates, uncosted, billing] = await Promise.all([
    totals(q, q),
    totals(q, q.previous),
    rateGroups(where),
    runAnalytics<{ uncostedCalls: number; uncostedTokens: number }>(Prisma.sql`
      SELECT COUNT(*)::int AS "uncostedCalls",
             COALESCE(SUM(u."inputTokens" + u."outputTokens" + u."cacheReadTokens" + u."cacheWriteTokens"), 0)::float8 AS "uncostedTokens"
      FROM llm_call_usage u WHERE ${where} AND u."priceId" IS NULL`),
    runAnalytics<TotalsRow & { key: string }>(Prisma.sql`SELECT u."billingBasis" AS key, ${TOTALS} FROM llm_call_usage u WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`),
  ]);
  return {
    scope: { level: q.isAdmin ? "org" : "own", isAdmin: q.isAdmin },
    range: { from: q.from, to: q.to },
    totals: current,
    previous,
    byBilling: billing.map(withTotal),
    costSplit: { rates, uncostedCalls: uncosted[0]?.uncostedCalls ?? 0, uncostedTokens: uncosted[0]?.uncostedTokens ?? 0 },
  };
}

export interface UsageSeries {
  days: string[];
  groupBy: GroupBy;
  /** Top keys by the charted metric, then "__other__" when more groups exist. */
  keys: Array<{ key: string; label: string }>;
  points: Array<{ day: string; key: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; calls: number }>;
}

export const OTHER_KEY = "__other__";

type SeriesRow = UsageSeries["points"][number];
export type SeriesMetric = "cost" | "tokens";

/** Keeps the top `top` keys by the charted metric (the other breaks ties) and folds the rest into OTHER_KEY. */
export function foldSeries(rows: SeriesRow[], top: number, metric: SeriesMetric = "cost"): { keys: string[]; points: SeriesRow[] } {
  const rank = new Map<string, { cost: number; tokens: number }>();
  for (const r of rows) {
    const t = rank.get(r.key) ?? { cost: 0, tokens: 0 };
    t.cost += r.costUsd;
    t.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    rank.set(r.key, t);
  }
  const [first, second] = metric === "tokens" ? (["tokens", "cost"] as const) : (["cost", "tokens"] as const);
  const ordered = [...rank.entries()].sort((a, b) => b[1][first] - a[1][first] || b[1][second] - a[1][second]).map(([k]) => k);
  const kept = new Set(ordered.slice(0, top));
  const folded = new Map<string, SeriesRow>();
  for (const r of rows) {
    const key = kept.has(r.key) ? r.key : OTHER_KEY;
    const id = `${r.day}\u0000${key}`;
    const acc = folded.get(id);
    if (!acc) folded.set(id, { ...r, key });
    else {
      acc.costUsd += r.costUsd;
      acc.inputTokens += r.inputTokens;
      acc.outputTokens += r.outputTokens;
      acc.cacheReadTokens += r.cacheReadTokens;
      acc.cacheWriteTokens += r.cacheWriteTokens;
      acc.calls += r.calls;
    }
  }
  const keys = ordered.slice(0, top);
  if (ordered.length > top) keys.push(OTHER_KEY);
  return { keys, points: [...folded.values()].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key)) };
}

export async function fetchUsageSeries(q: UsageQuery, groupBy: GroupBy, top: number, metric: SeriesMetric = "cost"): Promise<UsageSeries> {
  const key = groupBy === "pr" ? GROUP_KEY.session : GROUP_KEY[groupBy];
  const rows = await runAnalytics<SeriesRow>(Prisma.sql`
    SELECT to_char((u."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${q.tz}, 'YYYY-MM-DD') AS day,
           ${key} AS key,
           COALESCE(SUM(u."costUsd"), 0)::float8 AS "costUsd",
           COALESCE(SUM(u."inputTokens"), 0)::float8 AS "inputTokens",
           COALESCE(SUM(u."outputTokens"), 0)::float8 AS "outputTokens",
           COALESCE(SUM(u."cacheReadTokens"), 0)::float8 AS "cacheReadTokens",
           COALESCE(SUM(u."cacheWriteTokens"), 0)::float8 AS "cacheWriteTokens",
           COUNT(*)::int AS calls
    FROM llm_call_usage u WHERE ${filterSql(q)} AND ${windowSql(q)}
    GROUP BY 1, 2`);
  const { keys, points } = foldSeries(rows, top, metric);
  const labels = await labelsFor(q, groupBy, keys.filter((k) => k !== OTHER_KEY));
  return {
    days: dayList(q.from, q.to),
    groupBy,
    keys: keys.map((k) => ({ key: k, label: k === OTHER_KEY ? "Other" : labels.get(k)?.label ?? fallbackLabel(groupBy, k) })),
    points,
  };
}

export interface BreakdownRow extends UsageTotals {
  key: string;
  label: string;
  sublabel?: string;
  /** user rows: the Spaces user id, for the avatar. */
  spacesUserId?: string;
  firstAt: string;
  lastAt: string;
  /** session rows */
  peakContextTokens?: number;
  agentSlug?: string;
  userId?: string;
  /** pr rows */
  prUrl?: string;
  prStatus?: string;
  /** pr rows: PRs bound to the same session, which all show that session's cost. */
  prsInSession?: number;
}

export interface UsageBreakdown {
  groupBy: GroupBy;
  rows: BreakdownRow[];
  total: number;
  totals: UsageTotals;
}

const SORTS = new Set(["costUsd", "totalTokens", "calls", "runs", "sessions", "lastAt", "label"]);

export async function fetchUsageBreakdown(
  q: UsageQuery,
  groupBy: GroupBy,
  opts: { sort?: string | undefined; dir?: string | undefined; limit: number; offset: number; search?: string | undefined },
): Promise<UsageBreakdown> {
  const where = Prisma.sql`${filterSql(q)} AND ${windowSql(q)}`;
  type Raw = TotalsRow & { key: string; firstAt: Date; lastAt: Date; peak?: number; agentSlug?: string; userId?: string; prUrl?: string; prTitle?: string; prStatus?: string; prsInSession?: number };
  const extras = groupBy === "session"
    ? Prisma.sql`, MAX(u."inputTokens" + u."cacheReadTokens" + u."cacheWriteTokens")::float8 AS peak, MIN(u."agentSlug") AS "agentSlug", MIN(u."userId") AS "userId"`
    : Prisma.empty;
  const raw = groupBy === "pr"
    ? await runAnalytics<Raw>(Prisma.sql`
        WITH b AS (
          SELECT b.id, b."conversationId", b."externalKey", b.status, b.data,
                 COUNT(*) OVER (PARTITION BY b."conversationId")::int AS "prsInSession"
          FROM agent_widget_bindings b WHERE b.kind = 'pr' AND b."orgId" = ${q.orgId}
        )
        SELECT b.id AS key, MIN(b.data->>'url') AS "prUrl", MIN(b.data->>'title') AS "prTitle", MIN(b.status) AS "prStatus",
               MIN(b."prsInSession")::int AS "prsInSession", ${TOTALS},
               MIN(u."startedAt") AS "firstAt", MAX(u."startedAt") AS "lastAt"
        FROM llm_call_usage u JOIN b ON b."conversationId" = u."conversationId"
        WHERE ${where} GROUP BY b.id ORDER BY SUM(u."costUsd") DESC NULLS LAST LIMIT ${MAX_GROUPS}`)
    : await runAnalytics<Raw>(Prisma.sql`
        SELECT ${GROUP_KEY[groupBy]} AS key, ${TOTALS},
               MIN(u."startedAt") AS "firstAt", MAX(u."startedAt") AS "lastAt" ${extras}
        FROM llm_call_usage u WHERE ${where} GROUP BY 1 ORDER BY SUM(u."costUsd") DESC NULLS LAST LIMIT ${MAX_GROUPS}`);
  const labels = await labelsFor(q, groupBy, raw.map((r) => r.key));
  let rows: BreakdownRow[] = raw.map((r) => {
    const l = labels.get(r.key);
    const { firstAt, lastAt, peak, prTitle, ...rest } = r;
    const row: BreakdownRow = {
      ...withTotal(rest),
      key: r.key,
      label: groupBy === "pr" ? (prTitle || r.prUrl || r.key) : l?.label ?? fallbackLabel(groupBy, r.key),
      firstAt: firstAt.toISOString(),
      lastAt: lastAt.toISOString(),
    };
    if (l?.sublabel) row.sublabel = l.sublabel;
    if (l?.spacesUserId) row.spacesUserId = l.spacesUserId;
    if (peak !== undefined) row.peakContextTokens = peak;
    for (const k of ["agentSlug", "userId", "prUrl", "prStatus", "prsInSession"] as const) if (r[k] === undefined || r[k] === null) delete row[k];
    return row;
  });
  const search = opts.search?.trim().toLowerCase();
  if (search) rows = rows.filter((r) => `${r.label} ${r.sublabel ?? ""} ${r.key}`.toLowerCase().includes(search));
  const sort = opts.sort && SORTS.has(opts.sort) ? (opts.sort as keyof BreakdownRow) : "costUsd";
  const dir = opts.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sort] ?? 0;
    const bv = b[sort] ?? 0;
    const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
    return cmp * dir || b.totalTokens - a.totalTokens || a.key.localeCompare(b.key);
  });
  return { groupBy, rows: rows.slice(opts.offset, opts.offset + opts.limit), total: rows.length, totals: await totals(q, q) };
}

function fallbackLabel(groupBy: GroupBy, key: string): string {
  if (key === "") {
    const none: Partial<Record<GroupBy, string>> = { ticket: "No ticket", session: "No session", user: "Background (no user)", agent: "Background (no agent)" };
    return none[groupBy] ?? "Unknown";
  }
  return key;
}

async function labelsFor(q: Pick<UsageQuery, "orgId" | "workspaceId">, groupBy: GroupBy, keys: string[]): Promise<Map<string, { label: string; sublabel?: string; spacesUserId?: string }>> {
  const { orgId } = q;
  const ids = keys.filter((k) => k !== "");
  const out = new Map<string, { label: string; sublabel?: string; spacesUserId?: string }>();
  if (ids.length === 0) return out;
  if (groupBy === "agent") {
    for (const a of await prisma.agent.findMany({ where: { orgId, slug: { in: ids } }, select: { slug: true, name: true } })) out.set(a.slug, { label: a.name || a.slug, sublabel: a.slug });
  } else if (groupBy === "user") {
    const [users, identities] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
      prisma.userSurfaceIdentity.findMany({ where: { orgId, userId: { in: ids } }, select: { userId: true, surfaceUserId: true, surfaceWorkspaceId: true }, orderBy: { lastSeenAt: "desc" } }),
    ]);
    // One person can hold an identity per workspace; prefer the viewer's.
    const spaces = new Map<string, string>();
    for (const i of identities) if (i.userId && i.surfaceWorkspaceId === q.workspaceId) spaces.set(i.userId, i.surfaceUserId);
    for (const i of identities) if (i.userId && !spaces.has(i.userId)) spaces.set(i.userId, i.surfaceUserId);
    for (const u of users) out.set(u.id, { label: u.name || u.email, sublabel: u.email, ...(spaces.get(u.id) ? { spacesUserId: spaces.get(u.id)! } : {}) });
  } else if (groupBy === "session") {
    const metas = await prisma.chatConversationMeta.findMany({ where: { orgId, conversationId: { in: ids } }, select: { conversationId: true, title: true } });
    for (const m of metas) if (m.title && !out.has(m.conversationId)) out.set(m.conversationId, { label: m.title });
    // Untitled sessions fall back to their first message, as the chat sidebar does.
    const untitled = ids.filter((id) => !out.has(id));
    if (untitled.length > 0) {
      const firsts = await prisma.agentRun.findMany({
        where: { orgId, conversationId: { in: untitled } },
        distinct: ["conversationId"],
        orderBy: [{ conversationId: "asc" }, { startedAt: "asc" }],
        select: { conversationId: true, task: true },
      });
      for (const r of firsts) if (r.conversationId && r.task.trim()) out.set(r.conversationId, { label: r.task.trim().replace(/\s+/g, " ").slice(0, 80) });
    }
  }
  return out;
}

export interface SessionCall {
  id: string;
  startedAt: string;
  durationMs: number;
  runId: string | null;
  purpose: string;
  subagent: string | null;
  provider: string;
  billing: string;
  model: string;
  servedModel: string | null;
  outcome: string;
  usageReported: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number;
  costUsd: number | null;
  cumulativeCostUsd: number;
  toolNames: string[];
}

export interface SessionTimeline {
  conversationId: string;
  label: string | null;
  totals: UsageTotals;
  runs: Array<{ runId: string; agentSlug: string }>;
  calls: SessionCall[];
  truncated: boolean;
}

/** Cumulative cost in call order; unpriced calls add nothing. */
export function withCumulativeCost<T extends { costUsd: number | null }>(calls: T[]): Array<T & { cumulativeCostUsd: number }> {
  let sum = new Prisma.Decimal(0);
  return calls.map((c) => {
    if (c.costUsd !== null) sum = sum.add(c.costUsd);
    return { ...c, cumulativeCostUsd: sum.toNumber() };
  });
}

export async function fetchSessionTimeline(q: UsageQuery, conversationId: string): Promise<SessionTimeline | null> {
  const where: Prisma.LlmCallUsageWhereInput = { orgId: q.orgId, conversationId, ...(q.isAdmin ? {} : { userId: q.requesterId }) };
  const rows = await prisma.llmCallUsage.findMany({ where, orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: MAX_SESSION_CALLS + 1 });
  if (rows.length === 0) return null;
  const truncated = rows.length > MAX_SESSION_CALLS;
  const kept = rows.slice(0, MAX_SESSION_CALLS);
  const [runs, meta] = await Promise.all([
    prisma.agentRun.findMany({
      where: { orgId: q.orgId, conversationId, ...(q.isAdmin ? {} : { userId: q.requesterId }) },
      select: { sessionId: true, agentSlug: true },
      orderBy: { startedAt: "asc" },
      take: 1000,
    }),
    prisma.chatConversationMeta.findFirst({ where: { orgId: q.orgId, conversationId, title: { not: null } }, select: { title: true } }),
  ]);
  const calls = withCumulativeCost(kept.map((c) => ({
    id: c.id,
    startedAt: c.startedAt.toISOString(),
    durationMs: c.durationMs,
    runId: c.runId,
    purpose: c.callPurpose,
    subagent: c.subagentName,
    provider: c.provider,
    billing: c.billingBasis,
    model: c.model,
    servedModel: c.servedModel,
    outcome: c.callOutcome,
    usageReported: c.usageReported,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    cacheReadTokens: c.cacheReadTokens,
    cacheWriteTokens: c.cacheWriteTokens,
    contextTokens: c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens,
    costUsd: c.costUsd === null ? null : c.costUsd.toNumber(),
    toolNames: c.toolNames,
  })));
  const sum = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens") => kept.reduce((s, c) => s + c[k], 0);
  const totalsRow: TotalsRow = {
    costUsd: calls.at(-1)?.cumulativeCostUsd ?? 0,
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cacheReadTokens: sum("cacheReadTokens"), cacheWriteTokens: sum("cacheWriteTokens"),
    calls: kept.length,
    runs: new Set(kept.map((c) => c.runId).filter(Boolean)).size,
    sessions: 1,
    users: new Set(kept.map((c) => c.userId).filter(Boolean)).size,
    agents: new Set(kept.map((c) => c.agentSlug).filter(Boolean)).size,
    callsWithoutUsage: kept.filter((c) => !c.usageReported).length,
    unpricedCalls: kept.filter((c) => c.costUsd === null && c.billingBasis === "api_key").length,
  };
  return {
    conversationId,
    label: meta?.title ?? null,
    totals: withTotal(totalsRow),
    runs: runs.map((r) => ({ runId: r.sessionId, agentSlug: r.agentSlug })),
    calls,
    truncated,
  };
}

export interface ToolUsageRow {
  tool: string;
  /** Calls that read this tool's results and no other tool's. */
  soloCalls: number;
  /** Calls that read this tool's results together with other tools'. */
  sharedCalls: number;
  /** Exact context growth of solo calls: this call's prompt minus the previous call's prompt and reply. */
  soloContextTokens: number;
  maxSoloContextTokens: number;
}

export async function fetchToolUsage(q: UsageQuery): Promise<ToolUsageRow[]> {
  return runAnalytics<ToolUsageRow>(Prisma.sql`
    WITH c AS (
      SELECT u."toolNames" AS tools, u."usageReported" AS ok,
             u."inputTokens" + u."cacheReadTokens" + u."cacheWriteTokens" AS ctx,
             LAG(u."inputTokens" + u."cacheReadTokens" + u."cacheWriteTokens" + u."outputTokens") OVER w AS prev_end,
             LAG(u."usageReported") OVER w AS prev_ok,
             ${windowSql(q)} AS in_window
      FROM llm_call_usage u
      WHERE ${filterSql(q)} AND u."runId" IS NOT NULL AND u."callPurpose" IN ('main', 'subagent')
        AND u."startedAt" >= ${new Date(q.start.getTime() - DAY_MS)} AND u."startedAt" < ${q.end}
      WINDOW w AS (PARTITION BY u."runId", u."callPurpose", COALESCE(u."subagentName", '') ORDER BY u."startedAt", u.id)
    ), solo AS (
      SELECT *, (cardinality(tools) = 1 AND ok AND prev_ok AND ctx >= prev_end) AS exact FROM c WHERE in_window
    )
    SELECT t.tool,
           COUNT(*) FILTER (WHERE cardinality(s.tools) = 1)::int AS "soloCalls",
           COUNT(*) FILTER (WHERE cardinality(s.tools) > 1)::int AS "sharedCalls",
           COALESCE(SUM(s.ctx - s.prev_end) FILTER (WHERE s.exact), 0)::float8 AS "soloContextTokens",
           COALESCE(MAX(s.ctx - s.prev_end) FILTER (WHERE s.exact), 0)::float8 AS "maxSoloContextTokens"
    FROM solo s CROSS JOIN LATERAL unnest(s.tools) AS t(tool)
    GROUP BY t.tool ORDER BY "soloContextTokens" DESC, t.tool`);
}

export interface UsageOptions {
  agents: Array<{ key: string; label: string }>;
  users: Array<{ key: string; label: string; sublabel?: string; spacesUserId?: string }>;
}

/** Filter choices present in the window and scope (other filters ignored). */
export async function fetchUsageOptions(q: UsageQuery): Promise<UsageOptions> {
  const base = { ...q, agents: [], models: [], providers: [], tickets: [], users: q.isAdmin ? [] : [q.requesterId] };
  const rows = await runAnalytics<{ dim: string; key: string }>(Prisma.sql`
    SELECT DISTINCT d.dim, d.key FROM llm_call_usage u
    CROSS JOIN LATERAL (VALUES ('agent', u."agentSlug"), ('user', u."userId")) AS d(dim, key)
    WHERE ${filterSql(base)} AND ${windowSql(q)} AND d.key IS NOT NULL
    LIMIT ${MAX_GROUPS}`);
  const of = (dim: string) => rows.filter((r) => r.dim === dim).map((r) => r.key).sort();
  const [agentLabels, userLabels] = await Promise.all([labelsFor(q, "agent", of("agent")), labelsFor(q, "user", of("user"))]);
  return {
    agents: of("agent").map((k) => ({ key: k, label: agentLabels.get(k)?.label ?? k })),
    users: of("user").map((k) => {
      const l = userLabels.get(k);
      return { key: k, label: l?.label ?? k, ...(l?.sublabel ? { sublabel: l.sublabel } : {}), ...(l?.spacesUserId ? { spacesUserId: l.spacesUserId } : {}) };
    }),
  };
}

export interface UnpricedModel {
  provider: string;
  model: string;
  serviceTier: string;
  billing: string;
  calls: number;
  totalTokens: number;
}

/** The org's models with calls but no price row: API ones show as unpriced, platform ones cost 0 until priced. */
export async function fetchUnpricedModels(orgId: string): Promise<UnpricedModel[]> {
  const rows = await prisma.llmCallUsage.groupBy({
    by: ["provider", "model", "serviceTier", "billingBasis"],
    where: { orgId, priceId: null, billingBasis: { in: ["platform", "api_key"] } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
  });
  return rows
    .map((r) => ({
      provider: r.provider, model: r.model, serviceTier: r.serviceTier, billing: r.billingBasis, calls: r._count._all,
      totalTokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0) + (r._sum.cacheReadTokens ?? 0) + (r._sum.cacheWriteTokens ?? 0),
    }))
    .sort((a, b) => b.calls - a.calls);
}

export async function listPrices(): Promise<LlmModelPrice[]> {
  return prisma.llmModelPrice.findMany({ orderBy: [{ provider: "asc" }, { model: "asc" }, { effectiveFrom: "desc" }] });
}
