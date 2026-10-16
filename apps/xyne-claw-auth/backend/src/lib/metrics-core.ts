/**
 * Shared plumbing for every metrics reader: scope, window + orphan exclusion,
 * statement execution settings and caching. Run-level aggregates stay
 * index-only only while every query spells the window exactly as
 * "agent_runs_metrics_window_idx" was declared.
 *
 * SQL helpers take an optional table alias: omitted means `r`, `""` means
 * unqualified columns. Aliases are validated because they are spliced, not bound.
 */

import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { getAdminOrgScope } from "./admin-org-scope.js";
import { redisService } from "../redis.js";
import { MESSAGING_CHANNEL_KEYS } from "../surfaces/messaging/plugin.js";
import { createLogger } from "../logger.js";

export { runAnalytics } from "./metrics-sql.js";

const log = createLogger("metrics-core");


export type MetricsDays = 1 | 7 | 30;

export type WindowColumn = "completedAt" | "startedAt";

export interface AnalyticsWindow {
  windowStart: Date;
  windowEnd: Date;
  windowColumn: WindowColumn;
  agentSlugs?: readonly string[] | undefined;
  /** Unqualified legacy fragments; windowPredicate prefers the raw values below. */
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
  orgId?: string | undefined;
  userId?: string | undefined;
  allOrgs: boolean;
}

export interface MetricsScope {
  level: "org" | "own" | "all-orgs";
  orgId: string | null;
  requesterId: string;
  isAdmin: boolean;
}

export interface WindowInfo {
  days: MetricsDays;
  start: string;
  end: string;
  column: WindowColumn;
  scope: { level: MetricsScope["level"]; agentSlugs: string[] };
  computedAt: string;
  cached: boolean;
}

export type TriggerGroup = "user" | "automation" | "scheduled" | "api" | "awakened" | "delegation" | "messaging" | "other";


const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function column(alias: string | undefined, name: string): Prisma.Sql {
  const a = alias ?? "r";
  if (a !== "" && !IDENT_RE.test(a)) throw new Error(`invalid SQL alias: ${a}`);
  return Prisma.raw(a === "" ? `"${name}"` : `${a}."${name}"`);
}

/** Single-quoted SQL literal for compile-time constants only. */
const literal = (v: string): string => `'${v.replace(/'/g, "''")}'`;

export const ORPHAN_MARKER = "interrupted (orphaned run)";

/** Literal text, not a bind: the covering index is partial on exactly this predicate. */
export const ORPHAN_EXCLUSION = (alias?: string): Prisma.Sql => {
  const err = column(alias, "error").text;
  return Prisma.raw(`(${err} IS NULL OR ${err} <> ${literal(ORPHAN_MARKER)})`);
};

/** Wall clock of a run in ms; NULL while completedAt is NULL. */
export const WALL_MS = (alias?: string): Prisma.Sql =>
  Prisma.raw(`(EXTRACT(EPOCH FROM (${column(alias, "completedAt").text} - ${column(alias, "startedAt").text})) * 1000)`);

/** Full prompt size: cached prefix tokens are reported separately from tokensIn. */
export const PROMPT_TOKENS = (alias?: string): Prisma.Sql =>
  Prisma.raw(
    `(COALESCE(${column(alias, "tokensIn").text}, 0) + COALESCE(${column(alias, "tokensCacheRead").text}, 0)` +
      ` + COALESCE(${column(alias, "tokensCacheWrite").text}, 0))`,
  );

const USER_TRIGGERS = ["spaces", "chat", "app"] as const;
const AWAKENED_TRIGGERS = ["heartbeat", "reflex"] as const;
const MESSAGING_TRIGGERS = ["slack", ...MESSAGING_CHANNEL_KEYS] as const;
const inList = (values: readonly string[]): string => values.map(literal).join(", ");

/** Literals, not binds, so the expression text is stable for GROUP BY. Unknown sources are `other`. */
export const TRIGGER_GROUP = (alias?: string): Prisma.Sql => {
  const t = column(alias, "triggerSource").text;
  return Prisma.raw(
    `(CASE WHEN ${t} IN (${inList(USER_TRIGGERS)}) THEN 'user'` +
      ` WHEN ${t} = 'automation' THEN 'automation'` +
      ` WHEN ${t} = 'scheduled' THEN 'scheduled'` +
      ` WHEN ${t} = 'api' THEN 'api'` +
      ` WHEN ${t} IN (${inList(AWAKENED_TRIGGERS)}) THEN 'awakened'` +
      ` WHEN ${t} = 'delegation' THEN 'delegation'` +
      ` WHEN ${t} IN (${inList(MESSAGING_TRIGGERS)}) THEN 'messaging'` +
      ` ELSE 'other' END)`,
  );
};

export function agentPredicate(slugs: readonly string[] | undefined, alias?: string): Prisma.Sql {
  if (!slugs || slugs.length === 0) return Prisma.empty;
  const col = column(alias, "agentSlug");
  if (slugs.length === 1) return Prisma.sql`AND ${col} = ${slugs[0]}`;
  return Prisma.sql`AND ${col} IN (${Prisma.join([...slugs])})`;
}

/** Window + agent + scope + orphan exclusion; includeOrphans is for reads that report orphans. */
export function windowPredicate(w: AnalyticsWindow, opts: { alias?: string; includeOrphans?: boolean } = {}): Prisma.Sql {
  const { alias } = opts;
  const col = column(alias, w.windowColumn === "startedAt" ? "startedAt" : "completedAt");
  const user = w.userId !== undefined ? Prisma.sql`AND ${column(alias, "userId")} = ${w.userId}` : w.userFilter;
  const org = w.orgId !== undefined ? Prisma.sql`AND ${column(alias, "orgId")} = ${w.orgId}` : w.orgFilter;
  const orphan = opts.includeOrphans ? Prisma.empty : Prisma.sql`AND ${ORPHAN_EXCLUSION(alias)}`;
  return Prisma.sql`${col} >= ${w.windowStart} AND ${col} < ${w.windowEnd} ${agentPredicate(w.agentSlugs, alias)} ${user} ${org} ${orphan}`;
}

/** The window over a stats table: it has no `error` column and holds no orphan-closed runs. */
export function statsWindowPredicate(w: AnalyticsWindow, alias = "s"): Prisma.Sql {
  return windowPredicate(w, { alias, includeOrphans: true });
}

/** Viewers in the same minute share one window, hence one cache entry. */
export function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

/** Same length, ending where `w` starts. */
export function previousWindow(w: AnalyticsWindow): AnalyticsWindow {
  const len = w.windowEnd.getTime() - w.windowStart.getTime();
  return { ...w, windowStart: new Date(w.windowStart.getTime() - len), windowEnd: new Date(w.windowStart.getTime()) };
}


const ALLOWED_DAYS: readonly MetricsDays[] = [1, 7, 30];
const DEFAULT_DAYS: MetricsDays = 7;

/** Bounds the IN list a hand-edited URL can produce. */
const MAX_AGENT_FILTER = 50;

const isMetricsDays = (n: number): n is MetricsDays => (ALLOWED_DAYS as readonly number[]).includes(n);

/** Nearest allowed range, so no value can widen the scan; blank or non-numeric is 7. */
export function snapDays(raw: unknown): MetricsDays {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return DEFAULT_DAYS;
  if (isMetricsDays(n)) return n;
  return ALLOWED_DAYS.reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best), DEFAULT_DAYS);
}

export function parseDays(req: Request): MetricsDays {
  const raw = Number(req.query["days"]);
  return isMetricsDays(raw) ? raw : DEFAULT_DAYS;
}

function normaliseSlugs(values: readonly unknown[]): string[] {
  const slugs = values
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(slugs)].slice(0, MAX_AGENT_FILTER);
}

/** `?agentSlug=` single, repeated, or one comma list; deduped and capped. */
export function parseAgentSlugs(req: Request): string[] {
  const raw = req.query["agentSlug"];
  return normaliseSlugs(Array.isArray(raw) ? raw : [raw]);
}

export function parseIntParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** `?tz=` as a validated IANA zone, default UTC. */
export function parseTz(req: Request): string {
  const raw = req.query["tz"];
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(raw)) return "UTC";
  try {
    // Validate only: resolvedOptions() canonicalises to legacy aliases (Asia/Calcutta).
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}


function buildWindow(input: {
  days: MetricsDays;
  agentSlugs: readonly string[];
  orgId: string | undefined;
  userId: string | undefined;
  allOrgs: boolean;
}): AnalyticsWindow {
  const windowEnd = floorToMinute(new Date());
  const windowStart = new Date(windowEnd.getTime() - input.days * 24 * 60 * 60 * 1000);
  return {
    windowStart,
    windowEnd,
    windowColumn: "completedAt",
    agentSlugs: input.agentSlugs,
    userFilter: input.userId !== undefined ? Prisma.sql`AND "userId" = ${input.userId}` : Prisma.empty,
    orgFilter: !input.allOrgs && input.orgId !== undefined ? Prisma.sql`AND "orgId" = ${input.orgId}` : Prisma.empty,
    orgId: input.allOrgs ? undefined : input.orgId,
    userId: input.userId,
    allOrgs: input.allOrgs,
  };
}

/** Dashboard scope: admins see their org (or all orgs via getAdminOrgScope); others their own runs. */
export async function resolveRequestWindow(req: Request, endpoint: string): Promise<{
  window: AnalyticsWindow;
  scope: MetricsScope;
  days: MetricsDays;
  agentSlugs: string[];
}> {
  const requesterId = String(req.headers["x-user-id"] ?? "");
  if (!requesterId) throw new Error("x-user-id header is required");
  const admin = await isClawAdmin(requesterId);
  const adminScope = getAdminOrgScope(req, endpoint, admin);
  const orgId = adminScope.orgId
    ?? (adminScope.allOrgs
      ? undefined
      : (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId ?? undefined);
  if (!adminScope.allOrgs && !orgId) throw new Error("orgId is required");

  const days = parseDays(req);
  const agentSlugs = parseAgentSlugs(req);
  const window = buildWindow({ days, agentSlugs, orgId, userId: admin ? undefined : requesterId, allOrgs: adminScope.allOrgs });
  const scope: MetricsScope = {
    level: adminScope.allOrgs ? "all-orgs" : admin ? "org" : "own",
    orgId: adminScope.allOrgs ? null : (orgId ?? null),
    requesterId,
    isAdmin: admin,
  };
  return { window, scope, days, agentSlugs };
}

/**
 * Agent-tool scope: pinned to the run's org, fails closed. CLAW_ADMIN is global,
 * so admin breadth also requires the requester to belong to contextOrgId.
 */
export async function buildScopedWindow(input: {
  contextOrgId: string | undefined;
  requesterId: string | undefined;
  days: MetricsDays;
  agentSlugs?: string[];
}): Promise<{ window: AnalyticsWindow; scope: MetricsScope } | { error: string }> {
  const { contextOrgId, requesterId } = input;
  if (!contextOrgId) return { error: "metrics are unavailable: this run has no organisation context" };
  if (!requesterId) return { error: "metrics are unavailable: this run has no requesting user" };

  let admin = false;
  if (await isClawAdmin(requesterId)) {
    const user = await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } });
    admin = user?.orgId === contextOrgId;
  }
  const window = buildWindow({
    days: snapDays(input.days),
    agentSlugs: normaliseSlugs(input.agentSlugs ?? []),
    orgId: contextOrgId,
    userId: admin ? undefined : requesterId,
    allOrgs: false,
  });
  return { window, scope: { level: admin ? "org" : "own", orgId: contextOrgId, requesterId, isAdmin: admin } };
}

export function windowInfo(
  w: AnalyticsWindow,
  scope: MetricsScope,
  days: MetricsDays,
  agentSlugs: string[],
  cached: boolean,
): WindowInfo {
  return {
    days,
    start: w.windowStart.toISOString(),
    end: w.windowEnd.toISOString(),
    column: w.windowColumn,
    scope: { level: scope.level, agentSlugs },
    computedAt: new Date().toISOString(),
    cached,
  };
}


export const METRIC_TTL = { current: 60_000, previous: 15 * 60_000 } as const;

const LRU_MAX = 500;
const REDIS_PREFIX = "metrics:v2";
const GEN_PREFIX = "metrics:gen";
const GLOBAL_GEN = "_global";

/** A timed-out statement fails again on retry; remember the failure briefly so retries do not re-run it. */
export const FAILED_COMPUTE_TTL_MS = 15_000;

/** Anything but a 4xx (the caller's mistake); matched structurally because tool-analytics imports this module. */
export function isCacheableFailure(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return !(typeof status === "number" && status >= 400 && status < 500);
}

interface LruEntry { value: unknown; expiresAt: number; error?: { reason: unknown } }
const lru = new Map<string, LruEntry>();
const inflight = new Map<string, Promise<{ value: unknown; fromRedis: boolean }>>();
/** In-process generations: invalidation changes keys instead of scanning. */
const localGen = new Map<string, number>();

function lruGet(key: string): LruEntry | undefined {
  const hit = lru.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    lru.delete(key);
    return undefined;
  }
  lru.delete(key);
  lru.set(key, hit);
  return hit;
}

function lruSet(key: string, value: unknown, ttlMs: number, error?: { reason: unknown }): void {
  lru.delete(key);
  lru.set(key, { value, expiresAt: Date.now() + ttlMs, ...(error ? { error } : {}) });
  while (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

type RedisClient = ReturnType<typeof redisService.getConnection>;

/** Only a "ready" client: a command on a reconnecting one would stall the request. */
function liveRedis(): RedisClient | null {
  try {
    const client = redisService.getConnection();
    return client.status === "ready" ? client : null;
  } catch {
    return null;
  }
}

const scopeOrgKey = (w: AnalyticsWindow): string => (w.allOrgs ? "all" : (w.orgId ?? "none"));

/** JSON with sorted keys, so `{a,b}` and `{b,a}` share an entry. */
function stableJson(v: unknown): string {
  if (v === undefined) return "";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function baseKey(key: { endpoint: string; window: AnalyticsWindow; params?: Record<string, unknown> }): string {
  const w = key.window;
  const agents = [...(w.agentSlugs ?? [])].sort().join(",");
  return [
    key.endpoint,
    scopeOrgKey(w),
    w.userId ?? "admin",
    agents,
    w.windowColumn,
    `${w.windowStart.getTime()}-${w.windowEnd.getTime()}`,
    stableJson(key.params ?? {}),
  ].join(":");
}

/** With Redis only the shared counters, so pods address the same entry; otherwise the in-process ones. */
async function generation(org: string, redis: RedisClient | null): Promise<{ gen: string; redis: RedisClient | null }> {
  const local = `l${localGen.get(GLOBAL_GEN) ?? 0}.${localGen.get(org) ?? 0}`;
  if (!redis) return { gen: local, redis: null };
  try {
    const [g, o] = await redis.mget(`${GEN_PREFIX}:${GLOBAL_GEN}`, `${GEN_PREFIX}:${org}`);
    return { gen: `r${g ?? 0}.${o ?? 0}`, redis };
  } catch (err) {
    log.warn("metrics cache: redis generation read failed", { error: err instanceof Error ? err.message : String(err) });
    return { gen: local, redis: null };
  }
}

/**
 * Memoises one metric block: in-process LRU, then in-flight single-flight, then
 * Redis when live. Redis failures are logged and ignored. `cached` is true
 * whenever this call did not run `compute`. The key carries scope, agents,
 * window and params. A rejected compute is remembered in-process for
 * FAILED_COMPUTE_TTL_MS (never in Redis; 4xx never, see isCacheableFailure).
 */
export async function cachedMetric<T>(
  key: { endpoint: string; window: AnalyticsWindow; params?: Record<string, unknown> },
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  const org = scopeOrgKey(key.window);
  const { gen, redis } = await generation(org, liveRedis());
  const fullKey = `${REDIS_PREFIX}:${gen}:${baseKey(key)}`;

  const hit = lruGet(fullKey);
  if (hit) {
    if (hit.error) throw hit.error.reason;
    return { value: hit.value as T, cached: true };
  }

  const pending = inflight.get(fullKey);
  if (pending) return { value: (await pending).value as T, cached: true };

  const run = (async (): Promise<{ value: unknown; fromRedis: boolean }> => {
    if (redis) {
      try {
        const raw = await redis.get(fullKey);
        if (raw != null) {
          const value: unknown = JSON.parse(raw);
          lruSet(fullKey, value, ttlMs);
          return { value, fromRedis: true };
        }
      } catch (err) {
        log.warn("metrics cache: redis read failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    let value: unknown;
    try {
      value = await compute();
    } catch (err) {
      if (isCacheableFailure(err)) lruSet(fullKey, undefined, Math.min(ttlMs, FAILED_COMPUTE_TTL_MS), { reason: err });
      throw err;
    }
    lruSet(fullKey, value, ttlMs);
    if (redis) {
      try {
        redis.set(fullKey, JSON.stringify(value), "PX", ttlMs).catch((err: unknown) => {
          log.warn("metrics cache: redis write failed", { error: err instanceof Error ? err.message : String(err) });
        });
      } catch (err) {
        log.warn("metrics cache: value not serialisable", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { value, fromRedis: false };
  })();

  inflight.set(fullKey, run);
  try {
    const { value, fromRedis } = await run;
    return { value: value as T, cached: fromRedis };
  } finally {
    inflight.delete(fullKey);
  }
}

/** Drops cached blocks: the org's plus all-orgs entries, or everything. Bumps generations, no key scan. */
export async function invalidateMetricsCache(orgId?: string | null): Promise<void> {
  const keys = orgId ? [orgId, "all"] : [GLOBAL_GEN];
  for (const k of keys) localGen.set(k, (localGen.get(k) ?? 0) + 1);
  const redis = liveRedis();
  if (!redis) return;
  try {
    await Promise.all(keys.map((k) => redis.incr(`${GEN_PREFIX}:${k}`)));
  } catch (err) {
    log.warn("metrics cache: redis invalidation failed", { error: err instanceof Error ? err.message : String(err) });
  }
}


/** A ratio with no denominator is unknown, not zero. */
export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Minimum n before a figure is judged. */
export const SAMPLE_FLOORS = { p50: 5, p95: 20, avg: 5, rate: 30, toolRateRow: 10, recovery: 5 } as const;
