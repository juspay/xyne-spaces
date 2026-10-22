import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findUnique = vi.fn();
const isClawAdmin = vi.fn();

function fakeRedis(status = "ready") {
  const store = new Map<string, string>();
  const incr = async (k: string) => (store.set(k, String(Number(store.get(k) ?? 0) + 1)), Number(store.get(k)));
  return {
    status, store, incr,
    mget: async (...keys: string[]) => keys.map((k) => store.get(k) ?? null),
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, _mode?: string, _ttl?: number) => (store.set(k, v), "OK"),
  };
}

let redisClient = fakeRedis("wait");

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("../db.js", () => ({ prisma: { user: { findUnique } } }));
vi.mock("../middleware/agent-acl.js", () => ({
  isClawAdmin,
  getOrgId: (r: { headers: Record<string, string> }) => r.headers["x-org-id"] || undefined,
  getRequesterId: (r: { headers: Record<string, string> }) => r.headers["x-user-id"],
}));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => redisClient } }));

const core = await import("./metrics-core.js");
const { ORPHAN_EXCLUSION, TRIGGER_GROUP, WALL_MS, agentPredicate, windowPredicate, floorToMinute, previousWindow, rate, parseTz, parseDays, snapDays, parseAgentSlugs, parseIntParam, cachedMetric, invalidateMetricsCache, buildScopedWindow, resolveRequestWindow, windowInfo } = core;
type AnalyticsWindow = import("./metrics-core.js").AnalyticsWindow;

const ORPHAN_LITERAL = "'interrupted (orphaned run)'";
const DAY = 86_400_000;
const baseWindow: AnalyticsWindow = {
  windowStart: new Date("2026-10-01T00:00:00.000Z"), windowEnd: new Date("2026-10-08T00:00:00.000Z"), windowColumn: "completedAt",
  userFilter: Prisma.empty, orgFilter: Prisma.empty, allOrgs: false, orgId: "org-1",
};
const win = (over: Partial<AnalyticsWindow> = {}): AnalyticsWindow => ({ ...baseWindow, ...over });

const req = (query: Record<string, unknown> = {}, headers: Record<string, unknown> = {}) => ({ query, headers }) as unknown as import("express").Request;

const scoped = async (input: Parameters<typeof buildScopedWindow>[0]) => {
  const out = await buildScopedWindow(input);
  if ("error" in out) throw new Error(out.error);
  return out;
};

beforeEach(() => {
  for (const m of [findUnique, isClawAdmin]) m.mockClear();
  findUnique.mockReset();
  isClawAdmin.mockReset();
  redisClient = fakeRedis("wait");
});

describe("SQL expressions", () => {
  it("ORPHAN_EXCLUSION is spelled exactly as the partial index predicate and takes an alias", () => {
    const sql = ORPHAN_EXCLUSION();
    expect(sql.text).toBe(`(r."error" IS NULL OR r."error" <> ${ORPHAN_LITERAL})`);
    expect(sql.values).toEqual([]);
    expect(ORPHAN_EXCLUSION("a").text).toBe(`(a."error" IS NULL OR a."error" <> ${ORPHAN_LITERAL})`);
    expect(() => ORPHAN_EXCLUSION('r"; DROP TABLE x; --')).toThrow(/invalid SQL alias/);
  });

  it("WALL_MS and TRIGGER_GROUP render their expressions", () => {
    expect(WALL_MS("a").text).toBe('(EXTRACT(EPOCH FROM (a."completedAt" - a."startedAt")) * 1000)');
    for (const part of [`'spaces', 'chat', 'app') THEN 'user'`, `'heartbeat', 'reflex') THEN 'awakened'`, `'whatsapp-cloud') THEN 'messaging'`, "ELSE 'other' END"]) expect(TRIGGER_GROUP().text).toContain(part);
  });

  it("agentPredicate emits equality for one agent, a bound IN for several, nothing for none", () => {
    expect(agentPredicate(["euler"], "a").text).toBe('AND a."agentSlug" = $1');
    const many = agentPredicate(["euler", "gauss"]);
    expect([many.text.includes("euler"), many.values]).toEqual([false, ["euler", "gauss"]]);
    expect(agentPredicate([]).text).toBe("");
  });
});

describe("windowPredicate", () => {
  it("qualifies every column with the alias and binds the scope values", () => {
    const sql = windowPredicate(win({ userId: "u-1", agentSlugs: ["euler"] }), { alias: "a" });
    for (const part of ['a."completedAt" >= $1 AND a."completedAt" < $2', 'a."agentSlug" =', 'a."userId" =', 'a."orgId" =', `(a."error" IS NULL OR a."error" <> ${ORPHAN_LITERAL})`]) {
      expect(sql.text).toContain(part);
    }
    expect(sql.values).toEqual([baseWindow.windowStart, baseWindow.windowEnd, "euler", "u-1", "org-1"]);
  });

  it("drops only the orphan exclusion for includeOrphans, and the org filter for all-orgs", () => {
    expect(windowPredicate(baseWindow, { includeOrphans: true }).text).not.toContain("orphaned run");
    const all = windowPredicate(win({ orgId: undefined, allOrgs: true }));
    expect(all.text).not.toContain('"orgId"');
  });

  it("prefers raw scope values over the legacy fragments, which are only a fallback", () => {
    const legacy = { userFilter: Prisma.sql`AND "userId" = ${"u-9"}`, orgFilter: Prisma.sql`AND "orgId" = ${"o-9"}` };
    expect(windowPredicate(win({ userId: "u-1", ...legacy })).values).not.toContain("u-9");
    expect(windowPredicate(win({ orgId: undefined, ...legacy })).values).toEqual(expect.arrayContaining(["u-9", "o-9"]));
  });
});

describe("window and request helpers", () => {
  it("floorToMinute drops seconds, previousWindow ends where the window starts, rate is null without a denominator", () => {
    expect(floorToMinute(new Date("2026-10-15T10:42:59.999Z")).toISOString()).toBe("2026-10-15T10:42:00.000Z");
    const prev = previousWindow(win({ userId: "u-1" }));
    expect([prev.windowStart.toISOString(), prev.windowEnd.toISOString()]).toEqual(["2026-09-24T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
    expect([prev.userId, prev.orgId]).toEqual(["u-1", "org-1"]);
    expect([rate(3, 4), rate(0, 4), rate(3, 0), rate(0, -1)]).toEqual([0.75, 0, null, null]);
  });

  it("parseTz falls back to UTC; parseDays, parseIntParam and snapDays restrict to known ranges", () => {
    expect([parseTz(req({ tz: "Asia/Kolkata" })), parseTz(req({ tz: "Not/AZone" })), parseTz(req({ tz: "UTC'; DROP TABLE a; --" }))]).toEqual(["Asia/Kolkata", "UTC", "UTC"]);
    expect([parseDays(req({ days: "30" })), parseDays(req({ days: "90" })), parseDays(req({}))]).toEqual([30, 7, 7]);
    expect([parseIntParam("500", 50, 1, 200), parseIntParam("x", 50, 1, 200)]).toEqual([200, 50]);
    expect([undefined, "abc", 1, "30", 90, 3, 14, -5].map(snapDays)).toEqual([7, 7, 1, 30, 30, 1, 7, 1]);
    expect(parseAgentSlugs(req({ agentSlug: ["a", "b,c", " a "] }))).toEqual(["a", "b", "c"]);
    expect(parseAgentSlugs(req({ agentSlug: Array.from({ length: 80 }, (_, i) => `s${i}`).join(",") }))).toHaveLength(50);
  });

});

describe("cachedMetric", () => {
  it("runs compute once for concurrent misses and serves later calls from cache", async () => {
    let resolve!: (v: number) => void;
    const pending = new Promise<number>((r) => { resolve = r; });
    const compute = vi.fn(() => pending);
    const key = { endpoint: "sf", window: baseWindow };
    const a = cachedMetric(key, 60_000, compute);
    const b = cachedMetric(key, 60_000, compute);
    resolve(42);
    expect(await Promise.all([a, b])).toEqual([{ value: 42, cached: false }, { value: 42, cached: true }]);
    expect(await cachedMetric(key, 60_000, compute)).toEqual({ value: 42, cached: true });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("remembers a failure briefly, never a 4xx, and expires entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.parse("2026-10-15T10:00:00.000Z");
      vi.setSystemTime(t0);
      const key = { endpoint: "fail", window: baseWindow };
      const retry = vi.fn(async () => 1);
      await expect(cachedMetric(key, 60_000, () => Promise.reject(new Error("statement timeout")))).rejects.toThrow("statement timeout");
      await expect(cachedMetric(key, 60_000, retry)).rejects.toThrow("statement timeout");
      expect(retry).not.toHaveBeenCalled();
      vi.setSystemTime(t0 + 15_001);
      expect(await cachedMetric(key, 60_000, retry)).toEqual({ value: 1, cached: false });

      const badKey = { endpoint: "bad-request", window: baseWindow };
      await expect(cachedMetric(badKey, 60_000, () => Promise.reject(Object.assign(new Error("bad"), { status: 400 })))).rejects.toThrow("bad");
      expect(await cachedMetric(badKey, 60_000, async () => 2)).toEqual({ value: 2, cached: false });

      const ttlKey = { endpoint: "ttl", window: baseWindow };
      await cachedMetric(ttlKey, 1_000, retry);
      vi.setSystemTime(t0 + 15_001 + 999);
      expect((await cachedMetric(ttlKey, 1_000, retry)).cached).toBe(true);
      vi.setSystemTime(t0 + 15_001 + 1_000);
      expect((await cachedMetric(ttlKey, 1_000, retry)).cached).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates entries by org, user, agents, window and params, but not by agent or param order", async () => {
    let n = 0;
    const at = (w: AnalyticsWindow, params?: Record<string, unknown>) =>
      cachedMetric({ endpoint: "iso", window: w, ...(params ? { params } : {}) }, 60_000, async () => ++n);
    const admin = (await at(baseWindow)).value;
    for (const other of [win({ orgId: "org-2" }), win({ userId: "u-1" }), win({ orgId: undefined, allOrgs: true }), win({ windowEnd: new Date("2026-10-08T00:01:00.000Z") })]) {
      expect((await at(other)).value).not.toBe(admin);
    }
    expect((await at(baseWindow, { tool: "x" })).value).not.toBe(admin);
    const ab = await at(win({ agentSlugs: ["a", "b"] }), { x: 1, y: 2 });
    expect(await at(win({ agentSlugs: ["b", "a"] }), { y: 2, x: 1 })).toEqual({ value: ab.value, cached: true });
  });

  it("recomputes after invalidating the window's org only, and after a global invalidation", async () => {
    let n = 0;
    const compute = async () => ++n;
    const org1 = { endpoint: "inv", window: baseWindow };
    const org2 = { endpoint: "inv", window: win({ orgId: "org-2" }) };
    const [first, other] = [await cachedMetric(org1, 60_000, compute), await cachedMetric(org2, 60_000, compute)];
    await invalidateMetricsCache("org-1");
    expect((await cachedMetric(org1, 60_000, compute)).value).not.toBe(first.value);
    expect(await cachedMetric(org2, 60_000, compute)).toEqual({ value: other.value, cached: true });
    await invalidateMetricsCache();
    expect((await cachedMetric(org2, 60_000, compute)).cached).toBe(false);
  });

  it("survives Redis failures and shares values across processes", async () => {
    redisClient = Object.assign(fakeRedis("ready"), { mget: () => Promise.reject(new Error("redis down")) });
    expect(await cachedMetric({ endpoint: "redis-broken", window: baseWindow }, 60_000, async () => 7)).toEqual({ value: 7, cached: false });

    redisClient = fakeRedis("ready");
    const key = { endpoint: "redis-shared", window: baseWindow };
    expect(await cachedMetric(key, 60_000, async () => ({ runs: 5 }))).toEqual({ value: { runs: 5 }, cached: false });
    vi.resetModules();
    const compute = vi.fn(async () => ({ runs: 99 }));
    const fresh = await import("./metrics-core.js");
    expect(await fresh.cachedMetric(key, 60_000, compute)).toEqual({ value: { runs: 5 }, cached: true });
    expect(compute).not.toHaveBeenCalled();
  });
});

describe("buildScopedWindow", () => {
  it("fails closed without an org context or a requester", async () => {
    expect(await buildScopedWindow({ contextOrgId: undefined, requesterId: "u-1", days: 7 })).toHaveProperty("error");
    expect(await buildScopedWindow({ contextOrgId: "org-1", requesterId: undefined, days: 7 })).toHaveProperty("error");
  });

  it("scopes a non-admin to their own runs and computes the window length from days", async () => {
    isClawAdmin.mockResolvedValue(false);
    const out = await scoped({ contextOrgId: "org-1", requesterId: "u-1", days: 30, agentSlugs: ["a", "a", "b"] });
    expect(out.scope).toEqual({ level: "own", orgId: "org-1", requesterId: "u-1", isAdmin: false });
    expect(out.window).toMatchObject({ orgId: "org-1", userId: "u-1", allOrgs: false, windowColumn: "completedAt", agentSlugs: ["a", "b"] });
    expect(out.window.windowEnd.getTime() - out.window.windowStart.getTime()).toBe(30 * DAY);
  });

  it("gives an admin the whole org only when they belong to it, else downgrades to own runs", async () => {
    isClawAdmin.mockResolvedValue(true);
    findUnique.mockResolvedValue({ orgId: "org-1" });
    const out = await scoped({ contextOrgId: "org-1", requesterId: "admin-1", days: 7 });
    expect(out.scope).toEqual({ level: "org", orgId: "org-1", requesterId: "admin-1", isAdmin: true });
    for (const [row, ctx] of [[{ orgId: "org-A" }, "org-B"], [null, "org-1"]] as const) {
      findUnique.mockResolvedValue(row);
      const down = await scoped({ contextOrgId: ctx, requesterId: "admin-1", days: 7 });
      expect(down.scope).toEqual({ level: "own", orgId: ctx, requesterId: "admin-1", isAdmin: false });
      expect(down.window).toMatchObject({ userId: "admin-1", allOrgs: false });
    }
  });
});

describe("resolveRequestWindow", () => {
  it("scopes an admin to the header org, a non-admin to own runs, and all-orgs only for admins", async () => {
    isClawAdmin.mockResolvedValue(true);
    const admin = await resolveRequestWindow(req({ days: "1", agentSlug: "x" }, { "x-user-id": "admin-1", "x-org-id": "org-1" }), "/t");
    expect(admin.scope).toEqual({ level: "org", orgId: "org-1", requesterId: "admin-1", isAdmin: true });
    const all = await resolveRequestWindow(req({ orgScope: "all" }, { "x-user-id": "admin-1" }), "/t");
    expect(all.window.allOrgs).toBe(true);

    isClawAdmin.mockResolvedValue(false);
    findUnique.mockResolvedValue({ orgId: "org-9" });
    const own = await resolveRequestWindow(req({ orgScope: "all" }, { "x-user-id": "u-1" }), "/t");
    expect(own.scope).toEqual({ level: "own", orgId: "org-9", requesterId: "u-1", isAdmin: false });
    expect(own.window.allOrgs).toBe(false);
  });

  it("throws the messages the routes have always returned, and windowInfo reports window and scope", async () => {
    await expect(resolveRequestWindow(req({}, {}), "/t")).rejects.toThrow("x-user-id header is required");
    isClawAdmin.mockResolvedValue(false);
    findUnique.mockResolvedValue(null);
    await expect(resolveRequestWindow(req({}, { "x-user-id": "u-1" }), "/t")).rejects.toThrow("orgId is required");
    isClawAdmin.mockResolvedValue(true);
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req({ days: "7" }, { "x-user-id": "a", "x-org-id": "o" }), "/t");
    expect(windowInfo(window, scope, days, agentSlugs, true)).toMatchObject({ days: 7, column: "completedAt", cached: true, end: window.windowEnd.toISOString() });
  });
});
