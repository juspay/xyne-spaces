import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Characterization of GET /control-center/twin-reply-metrics through the public
// controlCenterRouter: one interleaved event log (admin-scope label, every Prisma
// call with its args, every warn line) plus the response body, compared strictly.
// The fake Prisma filters fixture rows by the `where` window, orders and caps them
// like the real query would, so previous-period reads return different rows from
// the main-period reads and a missing/extra orderBy is observable.

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    events: [] as unknown[][],
    scope: { allOrgs: false, orgId: undefined } as { allOrgs: boolean; orgId: string | undefined },
    tables: {} as Record<string, Row[]>,
  };

  const matches = (row: Row, where: Row): boolean => {
    for (const field of ["proposedAt", "createdAt", "occurredAt"]) {
      const range = where[field] as { gte?: Date; lt?: Date } | undefined;
      if (!range) continue;
      const at = (row[field] as Date).getTime();
      if (range.gte && at < range.gte.getTime()) return false;
      if (range.lt && at >= range.lt.getTime()) return false;
    }
    const ids = (where["userId"] as { in: unknown[] } | undefined)?.in;
    if (ids && !ids.includes(row["userId"])) return false;
    if ("orgId" in where && row["orgId"] !== where["orgId"]) return false;
    if ("runType" in where && row["runType"] !== where["runType"]) return false;
    return true;
  };

  const query = (
    model: string,
    args: { where: Row; select: Record<string, true>; orderBy?: Record<string, "desc">; take?: number },
  ): Row[] => {
    let rows = (state.tables[model] ?? []).filter((row) => matches(row, args.where));
    if (args.orderBy) {
      const [field] = Object.keys(args.orderBy) as [string];
      rows.sort((a, b) => (b[field] as Date).getTime() - (a[field] as Date).getTime());
    }
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows.map((row) => Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key]])));
  };

  const model = (name: string) => ({
    findMany: async (args: Parameters<typeof query>[1]) => {
      state.events.push(["prisma", name, structuredClone(args), Object.keys(args)]);
      return query(name, args);
    },
  });

  return { state, query, model };
});

type FindManyArgs = Parameters<typeof h.query>[1];

vi.mock("../db.js", () => ({
  prisma: {
    user: h.model("user"),
    twinResponseFeedback: h.model("twinResponseFeedback"),
    digitalTwinPipelineEvent: h.model("digitalTwinPipelineEvent"),
    twinBehaviorSignal: h.model("twinBehaviorSignal"),
  },
}));
vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: vi.fn() } }));
vi.mock("../lib/redis-scan.js", () => ({ scanKeys: vi.fn() }));
vi.mock("../middleware/require-auth.js", () => ({ requireStrictS2S: vi.fn() }));
vi.mock("../middleware/agent-acl.js", () => ({
  requireClawAdmin: function requireClawAdmin(_req: Request, _res: Response, next: NextFunction) {
    next();
  },
  getRequesterId: vi.fn(),
}));
vi.mock("../lib/admin-org-scope.js", () => ({
  getAdminOrgScope: (_req: Request, endpoint: string) => {
    h.state.events.push(["scope", endpoint]);
    return h.state.scope;
  },
  getOrgNameMap: vi.fn(),
  withOrgLabel: vi.fn(),
}));
vi.mock("../logger.js", () => ({
  createLogger: (component: string) => ({
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    warn: (...args: unknown[]) => h.state.events.push(["warn", component, ...args]),
  }),
}));

import { controlCenterRouter } from "./control-center.js";
import { requireClawAdmin } from "../middleware/agent-acl.js";
import {
  computeBehaviorAgg,
  computeGateAgg,
  computePerUser,
  computeReplyAgg,
  computeWeeklyTrend,
  type BehaviorRow,
  type GateEventRow,
  type ReplyFeedbackRow,
} from "../lib/twin-reply-metrics.js";

/* ── route lookup (works for a flat route and for one inside a nested router) ── */

type Handle = (req: Request, res: Response, next: NextFunction) => unknown;
interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handle }> };
  handle: Handle & { stack?: Layer[] };
}

function findRoute(stack: Layer[], path: string): NonNullable<Layer["route"]> | undefined {
  for (const layer of stack) {
    if (layer.route) {
      if (layer.route.path === path && layer.route.methods["get"]) return layer.route;
    } else if (layer.handle.stack) {
      const hit = findRoute(layer.handle.stack, path);
      if (hit) return hit;
    }
  }
  return undefined;
}

const route = findRoute((controlCenterRouter as unknown as { stack: Layer[] }).stack, "/twin-reply-metrics");

async function call(query: Record<string, unknown>, scope: Scope) {
  h.state.events.length = 0;
  h.state.scope = scope;
  let body: unknown;
  let error: unknown;
  await new Promise<void>((resolve) => {
    const res = {
      json: (payload: unknown) => {
        body = payload;
        resolve();
      },
    } as unknown as Response;
    const next = ((err?: unknown) => {
      error = err;
      resolve();
    }) as NextFunction;
    route!.stack.at(-1)!.handle({ query } as unknown as Request, res, next);
  });
  return { body, error, events: [...h.state.events] };
}

/* ── fixtures ──────────────────────────────────────────────────────────── */

interface Scope {
  allOrgs: boolean;
  orgId: string | undefined;
}
type Row = Record<string, unknown>;
type Tables = Record<"user" | "twinResponseFeedback" | "digitalTwinPipelineEvent" | "twinBehaviorSignal", Row[]>;

const NOW = Date.UTC(2026, 9, 1, 12);
const DAY = 86_400_000;
const at = (daysAgo: number, extraMs = 0) => new Date(NOW - daysAgo * DAY + extraMs);

const ORG1: Scope = { allOrgs: false, orgId: "org1" };
const ALL: Scope = { allOrgs: true, orgId: undefined };
const NO_ORG: Scope = { allOrgs: false, orgId: undefined };
const EMPTY_ORG: Scope = { allOrgs: false, orgId: "org-empty" };

const user = (id: string, orgId: string) => ({ id, name: `Name ${id}`, email: `${id}@example.com`, orgId });
const reply = (userId: string, status: string, deliveryAction: string, daysAgo: number, decidedAfterSec: number | null) => ({
  userId,
  status,
  deliveryAction,
  proposedAt: at(daysAgo),
  decidedAt: decidedAfterSec === null ? null : at(daysAgo, decidedAfterSec * 1000),
});
const gate = (userId: string, status: string, durationMs: number, daysAgo: number, trace: unknown, runType = "gate") => ({
  userId,
  status,
  durationMs,
  trace,
  runType,
  createdAt: at(daysAgo),
});
const behavior = (userId: string, outcome: string, gateDecision: string | null, shouldHaveResponded: boolean, daysAgo: number) => ({
  userId,
  outcome,
  gateDecision,
  shouldHaveResponded,
  occurredAt: at(daysAgo),
});

const NO_ROWS: Tables = { user: [], twinResponseFeedback: [], digitalTwinPipelineEvent: [], twinBehaviorSignal: [] };

/** org1 (u1-u3) and org2 (u4) with activity in the last week, the week before, and 20 days back. */
const SMALL: Tables = {
  user: [user("u1", "org1"), user("u2", "org1"), user("u3", "org1"), user("u4", "org2")],
  twinResponseFeedback: [
    reply("u1", "accepted", "react", 1, 60),
    reply("u1", "accepted_edited", "reply", 2, 120),
    reply("u2", "declined", "reply", 3, 30),
    reply("u3", "pending", "react", 4, null),
    reply("u4", "accepted", "reply", 2, 45),
    reply("u1", "declined", "reply", 8, 300),
    reply("u2", "declined", "react_and_reply", 9, 90),
    reply("u2", "accepted", "reply", 10, 15),
    reply("u3", "ignored", "react", 12, null),
    reply("u1", "accepted", "reply", 20, 10),
  ],
  digitalTwinPipelineEvent: [
    gate("u1", "ok", 120, 1, { confidence: 0.9, decisionSource: "llm" }),
    gate("u1", "empty", 80, 2, { confidence: 0.4, decisionSource: "rule" }),
    gate("u2", "error", 500, 3, null),
    gate("u3", "ok", 100, 3, "not-an-object"),
    gate("u4", "ok", 90, 2, { confidence: 0.7, decisionSource: "llm" }),
    gate("u1", "ok", 110, 2, { confidence: 0.5 }, "other"),
    gate("u1", "empty", 70, 9, { confidence: 0.3, decisionSource: "rule" }),
    gate("u2", "ok", 60, 11, { confidence: 0.8, decisionSource: "llm" }),
    gate("u3", "ok", 65, 25, { confidence: 0.6, decisionSource: "llm" }),
  ],
  twinBehaviorSignal: [
    behavior("u1", "responded", "respond", false, 1),
    behavior("u2", "responded", "ignore", true, 2),
    behavior("u3", "ignored", "ignore", false, 5),
    behavior("u4", "pending", null, false, 3),
    behavior("u1", "responded", "ignore", true, 10),
    behavior("u2", "ignored", "respond", false, 30),
  ],
};

/** 250 users in org1, each with one row in every table: more than the 200-user cut-off. */
const CROWD: Tables = {
  user: Array.from({ length: 250 }, (_, i) => user(`c${i}`, "org1")),
  twinResponseFeedback: Array.from({ length: 250 }, (_, i) => reply(`c${i}`, "accepted", "reply", 1 + i / 1000, i)),
  digitalTwinPipelineEvent: Array.from({ length: 250 }, (_, i) => gate(`c${i}`, "ok", 50 + i, 1 + i / 1000, { confidence: 0.5 })),
  twinBehaviorSignal: Array.from({ length: 250 }, (_, i) => behavior(`c${i}`, "responded", "respond", false, 1 + i / 1000)),
};

/**
 * 50,003 rows per table in the last ~5.8 days, plus 50,003 replies and gates in the previous
 * 7-day window stored oldest-first (so an unordered `take` returns different rows than a desc one).
 */
const HUGE_N = 50_003;
const HUGE: Tables = (() => {
  const uid = (i: number) => `h${i % 5}`;
  const tenSec = (i: number) => new Date(NOW - (i + 1) * 10_000);
  const beforeWeek = (j: number) => new Date(NOW - 7 * DAY - (HUGE_N - j) * 10_000);
  const statuses = ["accepted", "declined", "accepted_edited", "ignored"];
  return {
    user: Array.from({ length: 5 }, (_, i) => user(`h${i}`, "org1")),
    twinResponseFeedback: [
      ...Array.from({ length: HUGE_N }, (_, i) => ({ userId: uid(i), status: statuses[i % 4], deliveryAction: "reply", proposedAt: tenSec(i), decidedAt: null })),
      ...Array.from({ length: HUGE_N }, (_, j) => ({ userId: uid(j), status: statuses[(j >> 1) % 4], deliveryAction: "react", proposedAt: beforeWeek(j), decidedAt: null })),
    ],
    digitalTwinPipelineEvent: [
      ...Array.from({ length: HUGE_N }, (_, i) => ({ userId: uid(i), status: i % 3 ? "ok" : "empty", durationMs: i % 500, trace: null, runType: "gate", createdAt: tenSec(i) })),
      ...Array.from({ length: HUGE_N }, (_, j) => ({ userId: uid(j), status: (j >> 1) % 3 ? "ok" : "error", durationMs: j % 500, trace: null, runType: "gate", createdAt: beforeWeek(j) })),
    ],
    twinBehaviorSignal: Array.from({ length: HUGE_N }, (_, i) => ({ userId: uid(i), outcome: i % 2 ? "responded" : "ignored", gateDecision: "respond", shouldHaveResponded: i % 7 === 0, occurredAt: tenSec(i) })),
  };
})();

/* ── query shapes, each with the window the handler must derive ──────────── */

interface Win {
  since: Date | null;
  until: Date | null;
  days: number | null;
  prev: [Date, Date] | null;
}
const custom = (since: Date | null, until: Date | null): Win => ({ since, until, days: null, prev: null });
const preset = (days: number): Win => {
  const since = new Date(NOW - days * DAY);
  return { since, until: null, days, prev: [new Date(since.getTime() - days * DAY), since] };
};
const NONE = custom(null, null);

type Shape = readonly [name: string, query: Record<string, unknown>, win: Win];
const SHAPES: Shape[] = [
  ["no params", {}, NONE],
  ["days=7", { days: "7" }, preset(7)],
  ["days=30", { days: "30" }, preset(30)],
  ["days=1.5", { days: "1.5" }, preset(1.5)],
  ["days=abc", { days: "abc" }, NONE],
  ["days=-2", { days: "-2" }, NONE],
  ["days=0", { days: "0" }, NONE],
  ["days given twice", { days: ["7", "8"] }, NONE],
  ["from only", { from: "2026-09-05T00:00:00Z" }, custom(new Date("2026-09-05T00:00:00Z"), null)],
  ["to only", { to: "2026-09-20" }, custom(null, new Date("2026-09-20"))],
  ["from=garbage&days=30", { from: "garbage", days: "30" }, preset(30)],
  ["from + to + days", { from: "2026-09-05", to: "2026-09-25", days: "7" }, custom(new Date("2026-09-05"), new Date("2026-09-25"))],
  ["empty strings", { from: "", to: "" }, NONE],
  ["empty strings + days=7", { from: "", to: "", days: "7" }, preset(7)],
  ["from given as array", { from: ["2026-09-01"] }, NONE],
];
const shape = (name: string) => SHAPES.find(([n]) => n === name)!;
const NO_PARAMS = shape("no params");

/* ── expected outcome, derived from the window and the fixture rows ─────── */

const ENDPOINT = "/control-center/twin-reply-metrics";
const CAP = 50_000;
const SELECT = {
  reply: { userId: true, status: true, deliveryAction: true, proposedAt: true, decidedAt: true },
  gate: { userId: true, status: true, durationMs: true, trace: true },
  behavior: { userId: true, outcome: true, gateDecision: true, shouldHaveResponded: true },
} as const;

function range(field: string, from: Date | null, to: Date | null) {
  const bounds: Record<string, Date> = {};
  if (from) bounds["gte"] = from;
  if (to) bounds["lt"] = to;
  return from || to ? { [field]: bounds } : {};
}

function expectedOutcome(scope: Scope, win: Win) {
  const events: unknown[][] = [["scope", ENDPOINT]];
  const read = (model: string, args: FindManyArgs) => {
    events.push(["prisma", model, args, Object.keys(args)]);
    return h.query(model, args);
  };
  const envelope = (userCount: number) => ({
    scope: { orgScope: scope.allOrgs ? "all" : "org", userCount },
    window: { since: win.since?.toISOString() ?? null, until: win.until?.toISOString() ?? null, days: win.days },
  });

  const users = read("user", { where: scope.orgId ? { orgId: scope.orgId } : {}, select: { id: true, name: true, email: true } });
  if (scope.orgId && users.length === 0) {
    const data = {
      ...envelope(0),
      replies: { ...computeReplyAgg([]), previousApprovalRate: null, previousEditRate: null },
      gate: { ...computeGateAgg([]), previousRespondRate: null },
      behavior: computeBehaviorAgg([]),
      byUser: [],
    };
    return { events, body: { success: true, data } };
  }

  const who = scope.orgId ? { userId: { in: users.map((u) => u["id"]) } } : {};
  const replyArgs = (from: Date | null, to: Date | null, ordered: boolean): FindManyArgs => ({
    where: { ...who, ...range("proposedAt", from, to) },
    select: SELECT.reply,
    ...(ordered ? { orderBy: { proposedAt: "desc" } } : {}),
    take: CAP,
  });
  const gateArgs = (from: Date | null, to: Date | null, ordered: boolean): FindManyArgs => ({
    where: { ...who, runType: "gate", ...range("createdAt", from, to) },
    select: SELECT.gate,
    ...(ordered ? { orderBy: { createdAt: "desc" } } : {}),
    take: CAP,
  });

  const replyRows = read("twinResponseFeedback", replyArgs(win.since, win.until, true)) as unknown as ReplyFeedbackRow[];
  const gateRows = read("digitalTwinPipelineEvent", gateArgs(win.since, win.until, true)) as unknown as GateEventRow[];
  const behaviorRows = read("twinBehaviorSignal", {
    where: { ...who, ...range("occurredAt", win.since, win.until) },
    select: SELECT.behavior,
    orderBy: { occurredAt: "desc" },
    take: CAP,
  }) as unknown as BehaviorRow[];

  for (const [label, rows] of [["reply-feedback", replyRows], ["gate-events", gateRows], ["behavior-signals", behaviorRows]] as const) {
    if (rows.length >= CAP) events.push(["warn", "control-center", `[control-center] twin-reply-metrics ${label} hit row cap ${CAP}; totals truncated`]);
  }
  const perUser = computePerUser(users as never, replyRows, gateRows, behaviorRows);
  if (perUser.length > 200) events.push(["warn", "control-center", `[control-center] twin-reply-metrics returning top 200 of ${perUser.length} users`]);

  let previousApprovalRate: number | null = null;
  let previousEditRate: number | null = null;
  let previousRespondRate: number | null = null;
  if (win.prev) {
    const [from, to] = win.prev;
    const prevReply = computeReplyAgg(read("twinResponseFeedback", replyArgs(from, to, false)) as unknown as ReplyFeedbackRow[]);
    const prevGate = computeGateAgg(read("digitalTwinPipelineEvent", gateArgs(from, to, false)) as unknown as GateEventRow[]);
    previousApprovalRate = prevReply.approvalRate;
    previousEditRate = prevReply.editRate;
    previousRespondRate = prevGate.respondRate;
  }

  const data = {
    ...envelope(users.length),
    replies: { ...computeReplyAgg(replyRows), previousApprovalRate, previousEditRate, weekly: computeWeeklyTrend(replyRows) },
    gate: { ...computeGateAgg(gateRows), previousRespondRate },
    behavior: computeBehaviorAgg(behaviorRows),
    byUser: perUser.slice(0, 200),
  };
  return { events, body: { success: true, data } };
}

async function expectCharacterized(tables: Tables, scope: Scope, [, query, win]: Shape) {
  h.state.tables = { ...tables };
  const expected = expectedOutcome(scope, win);
  const actual = await call(query, scope);
  expect(actual.error).toBeUndefined();
  expect(actual.events).toStrictEqual(expected.events);
  expect(actual.body).toStrictEqual(expected.body);
  return actual as unknown as { body: { data: Record<string, any> }; events: unknown[][] };
}

/* ── tests ─────────────────────────────────────────────────────────────── */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("GET /twin-reply-metrics mounting", () => {
  it("is a GET route behind requireClawAdmin with the handler last", () => {
    expect(route).toBeDefined();
    expect(route!.stack).toHaveLength(2);
    expect(route!.stack[0]!.handle).toBe(requireClawAdmin);
  });
});

describe("twin reply metrics: org with users", () => {
  describe.each([["own org", ORG1], ["all orgs", ALL], ["no org id", NO_ORG]] as const)("%s", (_label, scope) => {
    it.each(SHAPES)("%s", async (...sh) => {
      await expectCharacterized(SMALL, scope, sh);
    });
  });

  it("days=7 for the own org: exact window, scope and previous-period deltas", async () => {
    const { body, events } = await expectCharacterized(SMALL, ORG1, shape("days=7"));
    const { data } = body;
    expect(events[0]).toStrictEqual(["scope", ENDPOINT]);
    expect(data["scope"]).toStrictEqual({ orgScope: "org", userCount: 3 });
    expect(data["window"]).toStrictEqual({ since: "2026-09-24T12:00:00.000Z", until: null, days: 7 });
    // 2 approved / 1 declined this week, 1 approved / 2 declined the week before.
    expect(data["replies"].approvalRate).toBeCloseTo(2 / 3);
    expect(data["replies"].previousApprovalRate).toBeCloseTo(1 / 3);
    expect(data["replies"].previousApprovalRate).not.toBe(data["replies"].approvalRate);
    expect(data["replies"].previousEditRate).toBe(0);
    expect(data["gate"].previousRespondRate).not.toBe(data["gate"].respondRate);
    expect(data["replies"].weekly.length).toBeGreaterThan(0);
  });

  it("a custom range has no previous-period deltas and no previous-period reads", async () => {
    const { body, events } = await expectCharacterized(SMALL, ORG1, shape("from + to + days"));
    expect(body.data["replies"].previousApprovalRate).toBeNull();
    expect(body.data["replies"].previousEditRate).toBeNull();
    expect(body.data["gate"].previousRespondRate).toBeNull();
    expect(events.filter((e) => e[0] === "prisma")).toHaveLength(4);
  });

  it("reads the previous period without an orderBy and only after the warn lines", async () => {
    const { events } = await expectCharacterized(SMALL, ORG1, shape("days=7"));
    const prisma = events.filter((e) => e[0] === "prisma");
    expect(prisma.map((e) => [e[1], e[3]])).toStrictEqual([
      ["user", ["where", "select"]],
      ["twinResponseFeedback", ["where", "select", "orderBy", "take"]],
      ["digitalTwinPipelineEvent", ["where", "select", "orderBy", "take"]],
      ["twinBehaviorSignal", ["where", "select", "orderBy", "take"]],
      ["twinResponseFeedback", ["where", "select", "take"]],
      ["digitalTwinPipelineEvent", ["where", "select", "take"]],
    ]);
  });
});

describe("twin reply metrics: org with no users", () => {
  it.each([NO_PARAMS, shape("days=7"), shape("from + to + days")])("%s returns the zero payload after one user read", async (...sh) => {
    const { body, events } = await expectCharacterized(SMALL, EMPTY_ORG, sh);
    expect(events.map((e) => e[0])).toStrictEqual(["scope", "prisma"]);
    expect(events[1]![1]).toBe("user");
    expect("weekly" in body.data["replies"]).toBe(false);
    expect(body.data["byUser"]).toStrictEqual([]);
    expect(body.data["scope"].userCount).toBe(0);
  });

  it("zero payload shape", async () => {
    const { body } = await expectCharacterized(SMALL, EMPTY_ORG, NO_PARAMS);
    expect(body).toMatchInlineSnapshot(`
      {
        "data": {
          "behavior": {
            "ignored": 0,
            "responded": 0,
            "shouldHaveResponded": 0,
            "total": 0,
          },
          "byUser": [],
          "gate": {
            "avgConfidence": null,
            "avgDurationMs": null,
            "byDecisionSource": [],
            "error": 0,
            "errorRate": null,
            "ignore": 0,
            "medianDurationMs": null,
            "previousRespondRate": null,
            "respond": 0,
            "respondRate": null,
            "total": 0,
          },
          "replies": {
            "accepted": 0,
            "acceptedEdited": 0,
            "approvalRate": null,
            "byAction": [],
            "declineRate": null,
            "declined": 0,
            "editRate": null,
            "ignored": 0,
            "pending": 0,
            "previousApprovalRate": null,
            "previousEditRate": null,
            "responseTime": {
              "avgSec": null,
              "count": 0,
              "medianSec": null,
              "p90Sec": null,
            },
            "total": 0,
            "totalApproved": 0,
          },
          "scope": {
            "orgScope": "org",
            "userCount": 0,
          },
          "window": {
            "days": null,
            "since": null,
            "until": null,
          },
        },
        "success": true,
      }
    `);
  });

  it("all orgs with an empty database still takes the normal path (weekly present)", async () => {
    const { body, events } = await expectCharacterized(NO_ROWS, ALL, shape("days=7"));
    expect(body.data["replies"].weekly).toStrictEqual([]);
    expect(body.data["scope"]).toStrictEqual({ orgScope: "all", userCount: 0 });
    expect(events.filter((e) => e[0] === "prisma")).toHaveLength(6);
  });
});

describe("twin reply metrics: more than 200 users with activity", () => {
  it.each([
    ["own org, days=7", ORG1, shape("days=7")],
    ["all orgs, no window", ALL, NO_PARAMS],
  ] as const)("%s logs the top-N warn and returns 200 users", async (_label, scope, sh) => {
    const { body, events } = await expectCharacterized(CROWD, scope, sh);
    expect(body.data["byUser"]).toHaveLength(200);
    expect(body.data["scope"].userCount).toBe(250);
    expect(events.filter((e) => e[0] === "warn")).toStrictEqual([
      ["warn", "control-center", "[control-center] twin-reply-metrics returning top 200 of 250 users"],
    ]);
  });
});

describe("twin reply metrics: row cap", () => {
  it.each([
    ["own org, days=7", ORG1, shape("days=7")],
    ["all orgs, days=7", ALL, shape("days=7")],
    ["all orgs, from only", ALL, shape("from only")],
    ["own org, no window", ORG1, NO_PARAMS],
  ] as const)("%s warns once per table that hit the cap", async (_label, scope, sh) => {
    const { events } = await expectCharacterized(HUGE, scope, sh);
    expect(events.filter((e) => e[0] === "warn")).toStrictEqual([
      ["warn", "control-center", "[control-center] twin-reply-metrics reply-feedback hit row cap 50000; totals truncated"],
      ["warn", "control-center", "[control-center] twin-reply-metrics gate-events hit row cap 50000; totals truncated"],
      ["warn", "control-center", "[control-center] twin-reply-metrics behavior-signals hit row cap 50000; totals truncated"],
    ]);
  }, 60_000);
});

describe("twin reply metrics: failures", () => {
  it("an out-of-range days value rejects through next() after the reads", async () => {
    h.state.tables = { ...SMALL };
    const { body, error, events } = await call({ days: "1e20" }, ORG1);
    expect(body).toBeUndefined();
    expect(error).toBeInstanceOf(RangeError);
    expect(events.map((e) => (e[0] === "prisma" ? e[1] : e[0]))).toStrictEqual([
      "scope",
      "user",
      "twinResponseFeedback",
      "digitalTwinPipelineEvent",
      "twinBehaviorSignal",
      "twinResponseFeedback",
      "digitalTwinPipelineEvent",
    ]);
  });
});
