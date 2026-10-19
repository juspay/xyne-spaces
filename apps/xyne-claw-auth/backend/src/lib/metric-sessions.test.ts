import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { runAnalytics } = vi.hoisted(() => ({ runAnalytics: vi.fn() }));
vi.mock("./metrics-core.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./metrics-core.js")>();
  return { ...actual, runAnalytics: (...args: unknown[]) => runAnalytics(...args) };
});
vi.mock("./tool-analytics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tool-analytics.js")>();
  return { ...actual, fetchToolStatsCoverage: vi.fn().mockResolvedValue({ runsInWindow: 10, runsSummarised: 6, coverage: 0.6 }) };
});

import { SIGNAL_CONDITIONS, TOOL_SIGNALS, decodeCursor, encodeCursor, fetchMetricSessions, normaliseSessionsRequest, sessionFilter, sessionPageSql, shapeSessionRow } from "./metric-sessions.js";
import type { AnalyticsWindow } from "./metrics-core.js";
const w: AnalyticsWindow = {
  windowStart: new Date("2026-09-15T00:00:00.000Z"), windowEnd: new Date("2026-10-15T00:00:00.000Z"), windowColumn: "completedAt",
  userFilter: Prisma.empty, orgFilter: Prisma.empty, orgId: "org1", allOrgs: false,
};

type Req = Omit<Parameters<typeof normaliseSessionsRequest>[0], "limit">;
const norm = (req: Req) => normaliseSessionsRequest({ limit: 25, ...req });
const page = (req: Req) => sessionPageSql(w, norm(req)).text;
const filter = (req: Req) => sessionFilter(w, norm(req));

describe("cursor codec", () => {
  it("round-trips, and rejects another ordering or garbage as a 400", () => {
    const c = { w: "completedAt" as const, k: 1_760_000_000_123, id: "run_42" };
    const enc = encodeCursor(c);
    expect(decodeCursor(enc, "completedAt")).toEqual(c);
    expect(() => decodeCursor(encodeCursor({ w: "wall", k: 1, id: "r" }), "completedAt")).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => decodeCursor("not-json", "wall")).toThrow();
  });
});

describe("SQL", () => {
  it.each(TOOL_SIGNALS)("tool signal %s filters on its condition and binds the tool name", (signal) => {
    const sql = filter({ kind: "tool", tool: "post-diff", signal });
    expect(sql.text).toMatch(/t\."tool" = \$\d+/);
    expect(sql.text).toContain(SIGNAL_CONDITIONS[signal]);
    expect(sql.values).toContain("post-diff");
  });

  it("narrows error classes via the tool row and pages tool kinds over agent_run_tool_stats", () => {
    expect(filter({ kind: "tool", tool: "x", errorClass: "boom" }).values).toContain(JSON.stringify([{ class: "boom" }]));
    expect(page({ kind: "tool", tool: "x" })).toContain('FROM "agent_run_tool_stats" t');
  });
  it.each([{ kind: "failed" }, { kind: "slow" }, { kind: "model", model: "gpt" }] as const)("kind=$kind applies the orphan exclusion, org filter and MATERIALIZED page", (req: Req) => {
    for (const part of [`'interrupted (orphaned run)'`, 'r."orgId" =', 'r."completedAt" >=', "MATERIALIZED"]) expect(page(req)).toContain(part);
  });

  it("joins per-run stats only for model, which matches the run column OR the per-call series; slow orders by wall clock", () => {
    expect(page({ kind: "model", model: "m" })).toContain('LEFT JOIN "agent_run_stats" xs');
    expect(page({ kind: "slow" })).toContain('ORDER BY "totalMs" DESC, "tool" LIMIT 3');
    expect(filter({ kind: "model", model: "gpt-5", provider: "litellm" }).text).toMatch(/r\."model" =[\s\S]*jsonb_path_exists/);
  });
});

describe("normaliseSessionsRequest", () => {
  it("clamps the page, requires tool or model and counts on page 1 only", () => {
    expect(normaliseSessionsRequest({ kind: "failed", limit: 500 }).limit).toBe(50);
    expect(() => norm({ kind: "tool" })).toThrow(/tool is required/);
    const cursor = encodeCursor({ w: "completedAt", k: 1, id: "r" });
    expect([true, false]).toEqual([{}, { cursor }].map((x) => norm({ kind: "failed", count: true, ...x }).count));
  });
});

const raw = (over: Record<string, unknown> = {}) => ({
  id: "r1", sessionId: "s1", conversationId: "c1", channelId: null, agentSlug: "xyne", userId: "owner", triggerSource: "chat", status: "completed",
  task: "summarise the call", startedAt: new Date("2026-10-01T00:00:00Z"), completedAt: new Date("2026-10-01T00:01:00Z"), wall_ms: 60000, totalMs: 55000,
  tokensIn: 10, tokensOut: 20, rating: null, usedUserToken: false, user_name: "Owner", user_email: "o@x.io", sort_key: 1,
  tool_stat: { t: "kb", c: 3, e: 2, rec: 1, d: 0, dup: 0, z: 0, ci: 0, nf: 0, ms: 900 }, sample: "boom", ...over,
});
const shape = (over: Record<string, unknown>, kind: Parameters<typeof shapeSessionRow>[1], viewer: Parameters<typeof shapeSessionRow>[2]) =>
  shapeSessionRow(raw(over) as never, kind, viewer);

describe("shapeSessionRow access rules", () => {
  it("withholds another user's personal-credential run text but keeps the row; the owner sees their own", () => {
    const row = shape({ usedUserToken: true }, "tool", { requesterAliases: ["admin"], isAdmin: true });
    expect(row).toMatchObject({ restricted: true, task: null, sample: null, conversationId: null, userName: null, userEmail: null, id: "r1" });
    expect(row.tool).toMatchObject({ c: 3, unrec: 1 });
    expect(shape({ usedUserToken: true }, "tool", { requesterAliases: ["owner"], isAdmin: false })).toMatchObject({ restricted: false, task: "summarise the call" });
  });

  it("strictText hides other users' text unless system-triggered; slow rows report wall clock as durationMs", () => {
    const viewer = { requesterAliases: ["admin"], isAdmin: true, strictText: true };
    expect(shape({}, "tool", viewer)).toMatchObject({ restricted: false, task: null, sample: null, conversationId: "c1" });
    expect(shape({ triggerSource: "scheduled" }, "tool", viewer).task).toBe("summarise the call");
    expect(shape({ error: "stack" }, "failed", viewer).error).toBeNull();
    expect(shape({}, "slow", { requesterAliases: ["owner"], isAdmin: false }).durationMs).toBe(60000);
  });
});

describe("fetchMetricSessions", () => {
  beforeEach(() => { runAnalytics.mockReset(); });
  it("runs under a forced custom plan with the 3 s ceiling, pages by keyset and caps the count", async () => {
    const rows = [300, 200, 100].map((k, i) => raw({ id: "abc"[i], sort_key: k }));
    runAnalytics.mockImplementation(async (sql: Prisma.Sql) => (sql.text.includes("count(*)::int AS n") ? [{ n: 1001 }] : rows));
    const res = await fetchMetricSessions(w, { kind: "tool", tool: "kb", signal: "errors", limit: 2, count: true }, { requesterAliases: ["owner"], isAdmin: false });
    for (const call of runAnalytics.mock.calls) expect(call[1]).toEqual({ customPlan: true, timeoutMs: 3000 });
    expect(res.rows).toHaveLength(2);
    expect(decodeCursor(res.page.nextCursor!, "completedAt")).toEqual({ w: "completedAt", k: 200, id: "b" });
    expect(res.total).toEqual({ value: 1000, capped: true });
  });

  it("issues a wall cursor for slow runs and no count without count=1", async () => {
    runAnalytics.mockResolvedValue([raw({ id: "a", sort_key: 9000.5 }), raw({ id: "b", sort_key: 8000 })]);
    const res = await fetchMetricSessions(w, { kind: "slow", limit: 1 }, { requesterAliases: [], isAdmin: true });
    expect([decodeCursor(res.page.nextCursor!, "wall").k, res.total]).toEqual([9000.5, null]);
  });
});
