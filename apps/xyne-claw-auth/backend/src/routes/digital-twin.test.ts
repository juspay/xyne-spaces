import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const m = vi.hoisted(() => {
  const fns = <K extends string>(...keys: K[]) => Object.fromEntries(keys.map((k) => [k, vi.fn()])) as Record<K, ReturnType<typeof vi.fn>>;
  return {
    logger: fns("info", "warn", "error", "debug"),
    user: fns("findUnique", "update"),
    candidate: fns("count", "groupBy", "findMany", "findFirst", "update", "deleteMany"),
    event: fns("findMany", "findFirst", "findUnique"),
    recallHit: fns("findMany"),
    agentRun: fns("count"),
    files: fns("ensureDefaultFiles", "listFiles", "setLoadInPrompt", "deleteFile", "upsertFile"),
    listUserTwinMemories: vi.fn(),
    memory: {} as Record<string, unknown>,
  };
});

vi.mock("../db.js", () => ({
  prisma: {
    user: m.user,
    userMemoryCandidate: m.candidate,
    digitalTwinPipelineEvent: m.event,
    memoryRecallHit: m.recallHit,
    agentRun: m.agentRun,
  },
}));
vi.mock("../logger.js", () => ({ createLogger: () => m.logger, createTraceId: () => "trace" }));
vi.mock("xyne-claw-shared", () => ({ DIGITAL_TWIN_BANK_ID: "twin-bank", getMemoryProvider: () => m.memory }));
vi.mock("../middleware/require-auth.js", () => ({ requireUserAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../queue/digital-twin-backfill-queue.js", () => ({
  cancelDigitalTwinBackfill: vi.fn(),
  enqueueDigitalTwinBackfill: vi.fn(),
  backfillJobIsLive: vi.fn(),
  probeBackfillJob: vi.fn(),
}));
vi.mock("../services/userMemoryFetcher.js", () => ({ countUserRecords: vi.fn() }));
vi.mock("../services/twinSourceRecords.js", () => ({ fetchSourceRecords: vi.fn() }));
vi.mock("../services/digitalTwinPipelineEvents.js", () => ({ recordPipelineEvent: vi.fn() }));
vi.mock("../services/userMemoryCuratorClient.js", () => ({
  curateAndPersistBatch: vi.fn(),
  curateRecordsInBatches: vi.fn(),
  DEFAULT_AUTO_APPROVE_MIN_SCORE: 0.9,
}));
vi.mock("../services/twinMemoryBank.js", () => ({
  ensureTwinBank: vi.fn(),
  listUserTwinMemories: m.listUserTwinMemories,
  retainTwinMemory: vi.fn(),
}));
vi.mock("../services/twinSoulSynthesizer.js", () => ({ synthesizeSoulFilesForUser: vi.fn() }));
vi.mock("../services/digitalTwinLifecycle.js", () => ({
  disableTwin: vi.fn(),
  enqueueBackfillForAllSources: vi.fn(),
  writeBackfillState: vi.fn(),
}));
vi.mock("../services/agentMemoryFiles.js", () => ({
  TWIN_AGENT_SLUG: "digital-twin",
  MAX_FILE_CHARS: 1000,
  MAX_LOADED_FILES: 5,
  MEMORY_FILE_NAME_RE: /^[a-zA-Z0-9._-]{1,64}$/,
  MaxLoadedFilesError: class MaxLoadedFilesError extends Error {},
  ...m.files,
}));

import { MaxLoadedFilesError } from "../services/agentMemoryFiles.js";
import { synthesizeSoulFilesForUser } from "../services/twinSoulSynthesizer.js";
import { disableTwin } from "../services/digitalTwinLifecycle.js";
import { ensureTwinBank, retainTwinMemory } from "../services/twinMemoryBank.js";
import { fetchSourceRecords } from "../services/twinSourceRecords.js";
import { recordPipelineEvent } from "../services/digitalTwinPipelineEvents.js";
import { curateRecordsInBatches } from "../services/userMemoryCuratorClient.js";
import { digitalTwinRouter } from "./digital-twin.js";

type Handler = (req: Request, res: Response) => Promise<void>;
type Route = { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> };
const routes = (digitalTwinRouter as unknown as { stack: Array<{ route?: Route }> }).stack.flatMap((l) => (l.route ? [l.route] : []));

// [method, path, logger.error message of its catch | null when it has no catch], in registration order.
const ROUTES: Array<[string, string, string | null]> = [
  ["get", "/status", "[digital-twin] /status failed"],
  ["get", "/estimate", "[digital-twin] /estimate failed"],
  ["post", "/enable", "[digital-twin] /enable failed"],
  ["post", "/backfill/pause", "[digital-twin] /backfill/pause failed"],
  ["post", "/backfill/resume", "[digital-twin] /backfill/resume failed"],
  ["get", "/memory-files", "[digital-twin] list memory-files failed"],
  ["put", "/memory-files/:name", "[digital-twin] put memory-file failed"],
  ["post", "/memory-files/:name/load", "[digital-twin] toggle memory-file load failed"],
  ["delete", "/memory-files/:name", "[digital-twin] delete memory-file failed"],
  ["post", "/synthesize", null],
  ["post", "/memories/delete", null],
  ["post", "/disable", "[digital-twin] /disable failed"],
  ["get", "/graph", "[digital-twin] /graph failed"],
  ["get", "/clusters", "[digital-twin] /clusters failed"],
  ["get", "/clusters/:subsystem", "[digital-twin] /clusters/:subsystem failed"],
  ["post", "/clusters/:subsystem/approve", "[digital-twin] /clusters/:subsystem/approve failed"],
  ["patch", "/candidates/:id", "[digital-twin] PATCH /candidates/:id failed"],
  ["get", "/metrics", "[digital-twin] GET /metrics failed"],
  ["patch", "/settings", "[digital-twin] PATCH /settings failed"],
  ["post", "/upload-md", "[digital-twin] /upload-md failed"],
  ["get", "/pipeline/events", "[digital-twin] GET /pipeline/events failed"],
  ["post", "/pipeline/events/:id/retry", "[digital-twin] POST /pipeline/events/:id/retry failed"],
  ["get", "/pipeline/events/:id", "[digital-twin] GET /pipeline/events/:id failed"],
];

function handlerFor(method: string, path: string): Handler {
  return routes.find((r) => r.path === path && r.methods[method])!.stack.at(-1)!.handle;
}
function call(method: string, path: string, req: Record<string, unknown> = {}, userId: string | null = "u1", jsonImpl?: () => void) {
  const json = vi.fn();
  const status = vi.fn();
  const res = { status, json } as unknown as Response;
  status.mockReturnValue(res);
  json.mockReturnValue(res);
  if (jsonImpl) json.mockImplementationOnce(jsonImpl);
  const headers = userId ? { "x-user-id": userId } : {};
  const done = handlerFor(method, path)({ headers, params: { name: "n", subsystem: "s", id: "i" }, query: {}, body: {}, ...req } as unknown as Request, res);
  return { done, status, json };
}

describe("digital twin router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.candidate.count.mockResolvedValue(0);
    for (const fn of [m.candidate.groupBy, m.candidate.findMany, m.event.findMany, m.recallHit.findMany]) fn.mockResolvedValue([]);
    m.agentRun.count.mockResolvedValue(0);
    m.files.ensureDefaultFiles.mockResolvedValue(undefined);
    for (const k of Object.keys(m.memory)) delete m.memory[k];
  });

  it("registers the same routes in order, each behind requireUserAuth + one handler", () => {
    expect(routes.map((r) => `${Object.keys(r.methods).join(",")} ${r.path} ${r.stack.length}`)).toEqual(
      ROUTES.map(([method, path]) => `${method} ${path} 2`),
    );
  });

  it.each(ROUTES)("%s %s answers 401 without x-user-id", async (method, path) => {
    const { done, status, json } = call(method, path, {}, null);
    await done;
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ success: false, error: "Unauthenticated" });
    expect(m.logger.error).not.toHaveBeenCalled();
  });

  it.each(ROUTES.filter(([, , msg]) => msg))("%s %s logs its own message and answers 500 on a thrown error", async (method, path, msg) => {
    const { done, status, json } = call(method, path, {}, "u-fail", () => {
      throw new Error("boom");
    });
    await done;
    expect(m.logger.error).toHaveBeenCalledTimes(1);
    expect(m.logger.error).toHaveBeenCalledWith(msg, { err: "boom" });
    expect(status).toHaveBeenLastCalledWith(500);
    expect(json).toHaveBeenLastCalledWith({ success: false, error: "Internal error" });
  });

  it.each(ROUTES.filter(([, , msg]) => !msg))("%s %s has no catch: a thrown error rejects unlogged", async (method, path) => {
    const { done } = call(method, path, {}, "u-fail", () => {
      throw new Error("boom");
    });
    await expect(done).rejects.toThrow("boom");
    expect(m.logger.error).not.toHaveBeenCalled();
  });

  it("maps memory-file load errors: MaxLoadedFilesError 400, not-found 404, anything else logged 500", async () => {
    const load = (err: Error) => {
      m.files.setLoadInPrompt.mockRejectedValue(err);
      return call("post", "/memory-files/:name/load", { body: { load: true } });
    };
    let r = load(new MaxLoadedFilesError("max"));
    await r.done;
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ success: false, error: "max" });
    r = load(new Error("not-found"));
    await r.done;
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ success: false, error: "File not found" });
    expect(m.logger.error).not.toHaveBeenCalled();
    r = load(new Error("other"));
    await r.done;
    expect(r.status).toHaveBeenCalledWith(500);
    expect(m.logger.error).toHaveBeenCalledWith("[digital-twin] toggle memory-file load failed", { err: "other" });
  });

  it("GET /status returns the user's twin state", async () => {
    m.user.findUnique.mockResolvedValue({
      digitalTwinEnabled: false,
      digitalTwinEnabledAt: null,
      digitalTwinBackfillState: null,
      digitalTwinResponseSuffix: null,
      digitalTwinMemoryApprovalMode: "manual",
      digitalTwinMemoryAutoApproveMinScore: 0.9,
      digitalTwinRespondPolicy: null,
    });
    m.candidate.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    const { done, json } = call("get", "/status");
    await done;
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        enabled: false,
        enabledAt: null,
        backfillState: null,
        backfill: null,
        pendingCandidates: 1,
        totalCandidates: 2,
        approvedCandidates: 3,
        memoryCount: 0,
        memoryDeleteInProgress: false,
        mdFileCount: 4,
        responseSuffix: "",
        respondPolicy: "always",
        memoryApprovalMode: "manual",
        memoryAutoApproveMinScore: 0.9,
      },
    });
  });

  it("PATCH /settings trims the suffix, writes by user id and echoes the persisted values", async () => {
    m.user.update.mockResolvedValue({
      digitalTwinResponseSuffix: "hi",
      digitalTwinMemoryApprovalMode: "auto",
      digitalTwinMemoryAutoApproveMinScore: 0.9,
      digitalTwinRespondPolicy: "always",
    });
    const { done, json } = call("patch", "/settings", { body: { responseSuffix: "  hi  " } });
    await done;
    expect(m.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" }, data: { digitalTwinResponseSuffix: "hi" } }));
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { responseSuffix: "hi", memoryApprovalMode: "auto", memoryAutoApproveMinScore: 0.9, respondPolicy: "always" },
    });
  });

  // ── PATCH /settings ──────────────────────────────────────────────────────
  describe("PATCH /settings validation", () => {
    const SELECT = {
      digitalTwinResponseSuffix: true,
      digitalTwinMemoryApprovalMode: true,
      digitalTwinMemoryAutoApproveMinScore: true,
      digitalTwinRespondPolicy: true,
    };
    beforeEach(() => {
      m.user.update.mockResolvedValue({
        digitalTwinResponseSuffix: null,
        digitalTwinMemoryApprovalMode: "manual",
        digitalTwinMemoryAutoApproveMinScore: 0.9,
        digitalTwinRespondPolicy: "always",
      });
    });
    async function patch(body: unknown) {
      const r = call("patch", "/settings", { body });
      await r.done;
      return r;
    }
    async function writes(body: Record<string, unknown>) {
      const r = await patch(body);
      expect(r.status).not.toHaveBeenCalled();
      expect(m.user.update).toHaveBeenCalledTimes(1);
      expect(m.user.update.mock.calls[0]![0]).toEqual({ where: { id: "u1" }, data: expect.anything(), select: SELECT });
      return (m.user.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    }
    async function rejects(body: unknown, error: string) {
      const r = await patch(body);
      expect(r.status).toHaveBeenCalledWith(400);
      expect(r.json).toHaveBeenCalledWith({ success: false, error });
      expect(m.user.update).not.toHaveBeenCalled();
    }

    it.each([[{}], [{ somethingElse: 1 }], [undefined]])("400s when no setting key is present (%j)", async (body) => {
      await rejects(body, "At least one setting is required");
    });

    it.each<[unknown, string | null]>([
      ["hi", "hi"],
      ["  hi  ", "hi"],
      ["", null],
      ["   ", null],
      [null, null],
      [5, null],
      [["x"], null],
      [{ a: 1 }, null],
      ["x".repeat(500), "x".repeat(500)],
      [` ${"x".repeat(500)} `, "x".repeat(500)],
    ])("responseSuffix %j is stored as %j", async (raw, stored) => {
      expect(await writes({ responseSuffix: raw })).toEqual({ digitalTwinResponseSuffix: stored });
    });
    it("rejects a responseSuffix over 500 chars after trimming", async () => {
      await rejects({ responseSuffix: "x".repeat(501) }, "responseSuffix must be ≤ 500 chars");
      await rejects({ responseSuffix: ` ${"x".repeat(501)}` }, "responseSuffix must be ≤ 500 chars");
    });

    it.each<[unknown, string]>([
      ["manual", "manual"],
      ["auto", "auto"],
      [" AUTO ", "auto"],
      ["Manual", "manual"],
      [["auto"], "auto"],
      [["AUTO "], "auto"],
    ])("memoryApprovalMode %j is stored as %j", async (raw, stored) => {
      expect(await writes({ memoryApprovalMode: raw })).toEqual({ digitalTwinMemoryApprovalMode: stored });
    });
    it.each<[unknown]>([["x"], [5], [null], [undefined], [""], [["a", "b"]], [{}], [true]])("memoryApprovalMode %j is a 400", async (raw) => {
      await rejects({ memoryApprovalMode: raw }, "memoryApprovalMode must be manual or auto");
    });

    it.each<[unknown, string]>([
      ["always", "always"],
      ["learned", "learned"],
      [" LEARNED ", "learned"],
      [["learned"], "learned"],
      [["ALWAYS "], "always"],
    ])("respondPolicy %j is stored as %j", async (raw, stored) => {
      expect(await writes({ respondPolicy: raw })).toEqual({ digitalTwinRespondPolicy: stored });
    });
    it.each<[unknown]>([["x"], [5], [null], [undefined], [""], [["a", "b"]], [{}], [true]])("respondPolicy %j is a 400", async (raw) => {
      await rejects({ respondPolicy: raw }, "respondPolicy must be always or learned");
    });

    it.each<[unknown, number]>([
      [null, 0.9],
      [undefined, 0.9],
      [0.7, 0.7],
      [1, 1],
      [0.85, 0.85],
      ["0.75", 0.75],
    ])("memoryAutoApproveMinScore %j is stored as %j", async (raw, stored) => {
      expect(await writes({ memoryAutoApproveMinScore: raw })).toEqual({ digitalTwinMemoryAutoApproveMinScore: stored });
    });
    it.each<[unknown]>([[0.69], [1.01], [0], [""], ["abc"], [NaN], [Infinity], [{}]])("memoryAutoApproveMinScore %j is a 400", async (raw) => {
      await rejects({ memoryAutoApproveMinScore: raw }, "memoryAutoApproveMinScore must be between 0.7 and 1");
    });

    it("writes every valid field in one update and echoes the persisted row", async () => {
      m.user.update.mockResolvedValue({
        digitalTwinResponseSuffix: "sfx",
        digitalTwinMemoryApprovalMode: "auto",
        digitalTwinMemoryAutoApproveMinScore: 0.8,
        digitalTwinRespondPolicy: "learned",
      });
      const r = await patch({ responseSuffix: " sfx ", memoryApprovalMode: "AUTO", memoryAutoApproveMinScore: 0.8, respondPolicy: "Learned" });
      expect(m.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: {
          digitalTwinResponseSuffix: "sfx",
          digitalTwinMemoryApprovalMode: "auto",
          digitalTwinMemoryAutoApproveMinScore: 0.8,
          digitalTwinRespondPolicy: "learned",
        },
        select: SELECT,
      });
      expect(Object.keys((m.user.update.mock.calls[0]![0] as { data: object }).data)).toEqual([
        "digitalTwinResponseSuffix",
        "digitalTwinMemoryApprovalMode",
        "digitalTwinMemoryAutoApproveMinScore",
        "digitalTwinRespondPolicy",
      ]);
      expect(r.json).toHaveBeenCalledWith({
        success: true,
        data: { responseSuffix: "sfx", memoryApprovalMode: "auto", memoryAutoApproveMinScore: 0.8, respondPolicy: "learned" },
      });
    });

    it("returns the first 400 in the order suffix, mode, score, policy", async () => {
      const bad = { responseSuffix: "x".repeat(501), memoryApprovalMode: "x", memoryAutoApproveMinScore: 5, respondPolicy: "x" };
      await rejects(bad, "responseSuffix must be ≤ 500 chars");
      const { responseSuffix: _s, ...noSuffix } = bad;
      await rejects(noSuffix, "memoryApprovalMode must be manual or auto");
      const { memoryApprovalMode: _m, ...noMode } = noSuffix;
      await rejects(noMode, "memoryAutoApproveMinScore must be between 0.7 and 1");
      const { memoryAutoApproveMinScore: _a, ...onlyPolicy } = noMode;
      await rejects(onlyPolicy, "respondPolicy must be always or learned");
    });

    it("echoes an empty string for a null stored suffix", async () => {
      m.user.update.mockResolvedValue({
        digitalTwinResponseSuffix: null,
        digitalTwinMemoryApprovalMode: "manual",
        digitalTwinMemoryAutoApproveMinScore: 0.9,
        digitalTwinRespondPolicy: "always",
      });
      const r = await patch({ responseSuffix: null });
      expect(r.json).toHaveBeenCalledWith({
        success: true,
        data: { responseSuffix: "", memoryApprovalMode: "manual", memoryAutoApproveMinScore: 0.9, respondPolicy: "always" },
      });
    });
  });

  // ── GET /metrics ─────────────────────────────────────────────────────────
  describe("GET /metrics", () => {
    const NOW = new Date("2026-03-15T12:00:00.000Z");
    const DAY = 24 * 60 * 60 * 1000;
    const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY);
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    async function metrics(query: Record<string, unknown>) {
      const r = call("get", "/metrics", { query });
      await r.done;
      expect(r.status).not.toHaveBeenCalled();
      return (r.json.mock.calls[0]![0] as { success: boolean; data: Record<string, unknown> }).data;
    }
    const countWheres = () => m.candidate.count.mock.calls.map((c) => (c[0] as { where: unknown }).where);

    it("days=7 windows the reviewed counts and queries the previous window", async () => {
      const since = ago(7);
      const prevSince = ago(7, since);
      m.candidate.count
        .mockResolvedValueOnce(10) // approvedClean
        .mockResolvedValueOnce(5) // approvedEdited
        .mockResolvedValueOnce(3) // rejected
        .mockResolvedValueOnce(7) // pending
        .mockResolvedValueOnce(4) // addedSinceYesterday
        .mockResolvedValueOnce(6) // prevApproved
        .mockResolvedValueOnce(2) // prevRejected
        .mockResolvedValueOnce(3); // prevApprovedEdited
      m.candidate.findFirst.mockResolvedValue({ createdAt: ago(3) });
      m.recallHit.findMany.mockResolvedValue([{ sessionId: "s1" }, { sessionId: "s2" }]);
      m.agentRun.count.mockResolvedValueOnce(4).mockResolvedValueOnce(3);

      const data = await metrics({ days: "7" });

      expect(countWheres()).toEqual([
        { userId: "u1", status: "approved", editedText: null, approvedAt: { gte: since } },
        { userId: "u1", status: "approved", NOT: { editedText: null }, approvedAt: { gte: since } },
        { userId: "u1", status: "rejected", rejectedAt: { gte: since } },
        { userId: "u1", status: "pending" },
        { userId: "u1", createdAt: { gte: ago(1) } },
        { userId: "u1", status: "approved", approvedAt: { gte: prevSince, lt: since } },
        { userId: "u1", status: "rejected", rejectedAt: { gte: prevSince, lt: since } },
        { userId: "u1", status: "approved", NOT: { editedText: null }, approvedAt: { gte: prevSince, lt: since } },
      ]);
      expect(m.candidate.groupBy.mock.calls.map((c) => c[0])).toEqual([
        {
          by: ["subsystem", "status"],
          where: {
            userId: "u1",
            OR: [
              { status: "approved", approvedAt: { gte: since } },
              { status: "rejected", rejectedAt: { gte: since } },
              { status: "pending" },
            ],
          },
          _count: { id: true },
        },
        {
          by: ["source", "status"],
          where: {
            userId: "u1",
            OR: [
              { status: "approved", approvedAt: { gte: since } },
              { status: "rejected", rejectedAt: { gte: since } },
            ],
          },
          _count: { id: true },
        },
      ]);
      expect(m.candidate.findFirst).toHaveBeenCalledWith({
        where: { userId: "u1", status: "pending" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      expect(m.recallHit.findMany).toHaveBeenCalledWith({
        where: { userId: "u1", agentSlug: "digital-twin", scope: "user", recalledAt: { gte: since } },
        select: { sessionId: true },
        distinct: ["sessionId"],
      });
      expect(m.agentRun.count.mock.calls.map((c) => c[0])).toEqual([
        { where: { sessionId: { in: ["s1", "s2"] }, rating: { not: null } } },
        { where: { sessionId: { in: ["s1", "s2"] }, rating: "up" } },
      ]);
      expect(data).toEqual({
        total: 25,
        approvedClean: 10,
        approvedEdited: 5,
        totalApproved: 15,
        rejected: 3,
        pending: 7,
        approvalRate: 83,
        editRate: 33,
        previousApprovalRate: 75,
        previousEditRate: 50,
        bySubsystem: [],
        bySource: [],
        oldestPendingDays: 3,
        addedSinceYesterday: 4,
        recallPrecision: 75,
        recallRatedCount: 4,
      });
    });

    it("days=7 with nothing reviewed leaves every rate null", async () => {
      const data = await metrics({ days: "7" });
      expect(m.candidate.count).toHaveBeenCalledTimes(8);
      expect(data).toMatchObject({
        total: 0,
        approvalRate: null,
        editRate: null,
        previousApprovalRate: null,
        previousEditRate: null,
        oldestPendingDays: null,
        recallPrecision: null,
        recallRatedCount: 0,
      });
      expect(m.agentRun.count).not.toHaveBeenCalled();
    });

    it.each<[string, Record<string, unknown>]>([
      ["no days", {}],
      ["days=0", { days: "0" }],
      ["days=-5", { days: "-5" }],
      ["days=abc", { days: "abc" }],
    ])("%s is unwindowed and skips the previous window", async (_name, query) => {
      m.candidate.count
        .mockResolvedValueOnce(8) // approvedClean
        .mockResolvedValueOnce(2) // approvedEdited
        .mockResolvedValueOnce(5) // rejected
        .mockResolvedValueOnce(1) // pending
        .mockResolvedValueOnce(9); // addedSinceYesterday
      const data = await metrics(query);
      expect(countWheres()).toEqual([
        { userId: "u1", status: "approved", editedText: null },
        { userId: "u1", status: "approved", NOT: { editedText: null } },
        { userId: "u1", status: "rejected" },
        { userId: "u1", status: "pending" },
        { userId: "u1", createdAt: { gte: ago(1) } },
      ]);
      expect(m.candidate.groupBy.mock.calls.map((c) => (c[0] as { where: unknown }).where)).toEqual([
        { userId: "u1" },
        { userId: "u1", status: { in: ["approved", "rejected"] } },
      ]);
      expect(m.recallHit.findMany).toHaveBeenCalledWith({
        where: { userId: "u1", agentSlug: "digital-twin", scope: "user" },
        select: { sessionId: true },
        distinct: ["sessionId"],
      });
      expect(data).toMatchObject({
        total: 16,
        totalApproved: 10,
        approvalRate: 67,
        editRate: 20,
        previousApprovalRate: null,
        previousEditRate: null,
        addedSinceYesterday: 9,
      });
    });

    it("tallies the subsystem and source breakdowns, ignoring unknown statuses", async () => {
      m.candidate.groupBy
        .mockResolvedValueOnce([
          { subsystem: "work", status: "approved", _count: { id: 2 } },
          { subsystem: "work", status: "pending", _count: { id: 3 } },
          { subsystem: "work", status: "rejected", _count: { id: 1 } },
          { subsystem: "work", status: "approved", _count: { id: 4 } },
          { subsystem: "work", status: "weird", _count: { id: 9 } },
          { subsystem: "work", status: "constructor", _count: { id: 9 } },
          { subsystem: "people", status: "weird", _count: { id: 4 } },
        ])
        .mockResolvedValueOnce([
          { source: "daily:2026-01-01", status: "approved", _count: { id: 5 } },
          { source: "upload:a.md", status: "rejected", _count: { id: 2 } },
          { source: "backfill:messages", status: "pending", _count: { id: 1 } },
          { source: "retry:2026-01-01:calls", status: "approved", _count: { id: 1 } },
          { source: "daily:2026-01-02", status: "approved", _count: { id: 1 } },
          { source: "daily:2026-01-03", status: "constructor", _count: { id: 7 } },
        ]);
      const data = await metrics({});
      expect(JSON.stringify(data["bySubsystem"])).toBe(
        JSON.stringify([
          { subsystem: "work", approved: 6, rejected: 1, pending: 3 },
          { subsystem: "people", approved: 0, rejected: 0, pending: 0 },
        ]),
      );
      expect(JSON.stringify(data["bySource"])).toBe(
        JSON.stringify([
          { source: "daily", approved: 6, rejected: 0 },
          { source: "upload", approved: 0, rejected: 2 },
          { source: "backfill", approved: 0, rejected: 0 },
          { source: "other", approved: 1, rejected: 0 },
        ]),
      );
    });
  });

  // ── GET /pipeline/events ─────────────────────────────────────────────────
  describe("pipeline events feed", () => {
    const EVENT_SELECT = {
      id: true, createdAt: true, runType: true, source: true, sourceKind: true,
      windowFrom: true, windowTo: true, status: true, recordCount: true,
      existingMemoryCount: true, emittedCount: true, keptCount: true,
      candidatesCreated: true, autoApproved: true, durationMs: true,
      error: true, trace: true,
    };
    const row = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
      id,
      createdAt: new Date(createdAt),
      runType: "backfill",
      source: "backfill:messages",
      sourceKind: "messages",
      windowFrom: new Date("2026-01-01T00:00:00Z"),
      windowTo: new Date("2026-01-02T00:00:00Z"),
      status: "ok",
      recordCount: 3,
      existingMemoryCount: 1,
      emittedCount: 2,
      keptCount: 2,
      candidatesCreated: 2,
      autoApproved: 0,
      durationMs: 50,
      error: null,
      trace: null,
      ...extra,
    });
    async function feed(query: Record<string, unknown>) {
      const r = call("get", "/pipeline/events", { query });
      await r.done;
      return r;
    }
    const findManyArg = () => m.event.findMany.mock.calls[0]![0] as { where: Record<string, unknown>; take: number };

    it("queries the requesting user's events newest first with the list projection", async () => {
      await feed({});
      expect(m.event.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: EVENT_SELECT,
      });
      expect(m.candidate.groupBy).not.toHaveBeenCalled();
    });

    it.each<[unknown, number]>([["10", 10], ["2.7", 2], ["999", 200], ["0", 50], ["-3", 50], ["abc", 50], [undefined, 50]])(
      "limit=%j takes %j",
      async (limit, take) => {
        await feed({ limit });
        expect(findManyArg().take).toBe(take);
      },
    );

    it("applies valid filters and ignores invalid or non-string ones", async () => {
      await feed({ runType: "gate", status: "retry", sourceKind: "calls", before: "2026-02-01T00:00:00.000Z" });
      expect(findManyArg().where).toEqual({
        userId: "u1",
        createdAt: { lt: new Date("2026-02-01T00:00:00.000Z") },
        runType: "gate",
        status: "retry",
        sourceKind: "calls",
      });
      m.event.findMany.mockClear();
      await feed({ runType: "weird", status: "weird", sourceKind: "docs", before: "garbage" });
      expect(findManyArg().where).toEqual({ userId: "u1" });
      m.event.findMany.mockClear();
      await feed({ runType: ["gate"], status: ["ok"], sourceKind: ["calls"], before: ["2026-02-01T00:00:00.000Z"] });
      expect(findManyArg().where).toEqual({ userId: "u1" });
    });

    it.each(["backfill", "daily", "upload", "twin-approval", "synthesize", "gate"])("accepts runType %s", async (runType) => {
      await feed({ runType });
      expect(findManyArg().where).toEqual({ userId: "u1", runType });
    });
    it.each(["ok", "empty", "error", "running", "retry"])("accepts status %s", async (status) => {
      await feed({ status });
      expect(findManyArg().where).toEqual({ userId: "u1", status });
    });
    it.each(["messages", "calls", "canvases"])("accepts sourceKind %s", async (sourceKind) => {
      await feed({ sourceKind });
      expect(findManyArg().where).toEqual({ userId: "u1", sourceKind });
    });

    it("adds the live approval outcome per event, skips unlinked groups and never leaks userId/records", async () => {
      m.event.findMany.mockResolvedValue([
        row("e1", "2026-03-02T00:00:00Z", { userId: "u1", records: [{ id: "r" }] }),
        row("e2", "2026-03-01T00:00:00Z", { trace: { any: "thing" } }),
      ]);
      m.candidate.groupBy.mockResolvedValue([
        { pipelineEventId: "e1", status: "approved", _count: { _all: 2 } },
        { pipelineEventId: "e1", status: "pending", _count: { _all: 1 } },
        { pipelineEventId: "e1", status: "rejected", _count: { _all: 4 } },
        { pipelineEventId: "e1", status: "approved", _count: { _all: 1 } },
        { pipelineEventId: "e1", status: "weird", _count: { _all: 9 } },
        { pipelineEventId: "e1", status: "constructor", _count: { _all: 9 } },
        { pipelineEventId: null, status: "approved", _count: { _all: 1 } },
      ]);
      const r = await feed({});
      expect(m.candidate.groupBy).toHaveBeenCalledWith({
        by: ["pipelineEventId", "status"],
        where: { pipelineEventId: { in: ["e1", "e2"] } },
        _count: { _all: true },
      });
      const body = r.json.mock.calls[0]![0] as { success: boolean; data: { events: Array<Record<string, unknown>>; nextBefore: string | null } };
      expect(body.success).toBe(true);
      expect(body.data.nextBefore).toBeNull();
      const [e1, e2] = body.data.events as [Record<string, unknown>, Record<string, unknown>];
      expect(e1).toEqual({
        ...row("e1", "2026-03-02T00:00:00Z"),
        trace: undefined,
        hasTrace: false,
        approvedCount: 3,
        pendingCount: 1,
        rejectedCount: 4,
      });
      expect(Object.keys(e1)).toEqual([
        "id", "createdAt", "runType", "source", "sourceKind", "windowFrom", "windowTo", "status", "recordCount",
        "existingMemoryCount", "emittedCount", "keptCount", "candidatesCreated", "autoApproved", "durationMs", "error",
        "hasTrace", "approvedCount", "pendingCount", "rejectedCount",
      ]);
      expect(e2).toMatchObject({ id: "e2", hasTrace: true, approvedCount: 0, pendingCount: 0, rejectedCount: 0 });
      expect(e2).not.toHaveProperty("trace");
      expect(e2).not.toHaveProperty("records");
    });

    it("sets nextBefore to the last createdAt only when a full page came back", async () => {
      m.event.findMany.mockResolvedValue([row("e1", "2026-03-02T00:00:00Z"), row("e2", "2026-03-01T00:00:00.500Z")]);
      let r = await feed({ limit: "2" });
      expect((r.json.mock.calls[0]![0] as { data: { nextBefore: unknown } }).data.nextBefore).toBe("2026-03-01T00:00:00.500Z");
      r = await feed({ limit: "3" });
      expect((r.json.mock.calls[0]![0] as { data: { nextBefore: unknown } }).data.nextBefore).toBeNull();
    });
  });

  describe("GET /pipeline/events/:id", () => {
    const full = (extra: Record<string, unknown> = {}) => ({
      id: "ev1",
      userId: "u1",
      createdAt: new Date("2026-03-02T00:00:00Z"),
      runType: "daily",
      source: "daily:2026-03-02",
      sourceKind: null,
      windowFrom: new Date("2026-03-01T00:00:00Z"),
      windowTo: new Date("2026-03-02T00:00:00Z"),
      status: "error",
      recordCount: 0,
      existingMemoryCount: 0,
      emittedCount: 0,
      keptCount: 0,
      candidatesCreated: 0,
      autoApproved: 0,
      durationMs: 5,
      error: "boom",
      trace: { t: 1 },
      records: [{ id: "r1" }],
      ...extra,
    });
    async function detail(userId = "u1") {
      const r = call("get", "/pipeline/events/:id", { params: { id: "ev1" } }, userId);
      await r.done;
      return r;
    }

    it("returns the summary plus records and trace for the owner", async () => {
      m.event.findUnique.mockResolvedValue(full());
      const r = await detail();
      expect(m.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev1" } });
      const { userId: _u, records: _r, trace: _t, ...rest } = full();
      expect(r.json).toHaveBeenCalledWith({
        success: true,
        data: { ...rest, hasTrace: true, records: [{ id: "r1" }], trace: { t: 1 } },
      });
      const data = (r.json.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty("userId");
    });

    it("nulls missing records and trace", async () => {
      m.event.findUnique.mockResolvedValue(full({ records: undefined, trace: null }));
      const r = await detail();
      const data = (r.json.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({ hasTrace: false, records: null, trace: null });
    });

    it("404s for a missing row and for another user's row", async () => {
      m.event.findUnique.mockResolvedValue(null);
      let r = await detail();
      expect(r.status).toHaveBeenCalledWith(404);
      expect(r.json).toHaveBeenCalledWith({ success: false, error: "Event not found" });
      m.event.findUnique.mockResolvedValue(full({ userId: "someone-else" }));
      r = await detail();
      expect(r.status).toHaveBeenCalledWith(404);
      expect(r.json).toHaveBeenCalledWith({ success: false, error: "Event not found" });
    });
  });

  // ── Background work behind an in-flight lock ─────────────────────────────
  describe("background routes", () => {
    const flush = async () => {
      for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
    };
    async function run(method: string, path: string, req: Record<string, unknown>, userId: string) {
      const r = call(method, path, req, userId);
      await r.done;
      return r;
    }
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    });
    afterEach(() => vi.useRealTimers());

    describe("POST /synthesize", () => {
      it("202s started, dedupes while running and releases the lock afterwards", async () => {
        vi.mocked(synthesizeSoulFilesForUser).mockResolvedValue(undefined as never);
        let r = await run("post", "/synthesize", {}, "synth-ok");
        expect(r.status).toHaveBeenCalledWith(202);
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "started" } });
        r = await run("post", "/synthesize", {}, "synth-ok");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "already-running" } });
        expect(synthesizeSoulFilesForUser).not.toHaveBeenCalled();
        await flush();
        expect(synthesizeSoulFilesForUser).toHaveBeenCalledTimes(1);
        expect(synthesizeSoulFilesForUser).toHaveBeenCalledWith("synth-ok", "manual");
        r = await run("post", "/synthesize", {}, "synth-ok");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "started" } });
        await flush();
      });

      it("logs a failed rebuild as a warning and still releases the lock", async () => {
        vi.mocked(synthesizeSoulFilesForUser).mockRejectedValue(new Error("boom"));
        await run("post", "/synthesize", {}, "synth-fail");
        await flush();
        expect(m.logger.warn).toHaveBeenCalledWith("[digital-twin] synthesize failed", { userId: "synth-fail", err: "boom" });
        const r = await run("post", "/synthesize", {}, "synth-fail");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "started" } });
        await flush();
      });
    });

    describe("POST /memories/delete", () => {
      it("deletes everything in the background, dedupes and releases the lock", async () => {
        m.candidate.deleteMany.mockResolvedValue({ count: 2 });
        let r = await run("post", "/memories/delete", { body: {} }, "del-all");
        expect(r.status).toHaveBeenCalledWith(202);
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { deleting: true, mode: "all" } });
        r = await run("post", "/memories/delete", { body: {} }, "del-all");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { deleting: true, message: "Delete already running" } });
        expect(m.candidate.deleteMany).not.toHaveBeenCalled();
        await flush();
        expect(m.candidate.deleteMany).toHaveBeenCalledWith({ where: { userId: "del-all" } });
        expect(m.logger.info).toHaveBeenCalledWith("[digital-twin] memory delete complete", {
          userId: "del-all",
          mode: "all",
          deleted: 0,
          candidatesDeleted: 2,
        });
        r = await run("post", "/memories/delete", { body: {} }, "del-all");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { deleting: true, mode: "all" } });
        await flush();
      });

      it("deletes a created-date range and validates it up front", async () => {
        m.listUserTwinMemories.mockResolvedValue([]);
        m.candidate.deleteMany.mockResolvedValue({ count: 1 });
        const bad = await run("post", "/memories/delete", { body: { mode: "range", from: "x", to: "y" } }, "del-range");
        expect(bad.status).toHaveBeenCalledWith(400);
        expect(bad.json).toHaveBeenCalledWith({ success: false, error: "range requires valid from ≤ to (ISO dates)" });
        const r = await run("post", "/memories/delete", { body: { mode: "range", from: "2026-01-01", to: "2026-02-01" } }, "del-range");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { deleting: true, mode: "range" } });
        await flush();
        expect(m.candidate.deleteMany).toHaveBeenCalledWith({
          where: { userId: "del-range", createdAt: { gte: new Date("2026-01-01"), lte: new Date("2026-02-01") } },
        });
      });

      it("logs a crash and releases the lock", async () => {
        m.candidate.deleteMany.mockRejectedValue(new Error("db down"));
        await run("post", "/memories/delete", { body: {} }, "del-crash");
        await flush();
        expect(m.logger.error).toHaveBeenCalledWith("[digital-twin] memory delete crashed", {
          userId: "del-crash",
          mode: "all",
          err: "db down",
        });
        m.candidate.deleteMany.mockResolvedValue({ count: 0 });
        const r = await run("post", "/memories/delete", { body: {} }, "del-crash");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { deleting: true, mode: "all" } });
        await flush();
      });
    });

    describe("POST /disable", () => {
      it("answers synchronously when memories are kept", async () => {
        vi.mocked(disableTwin).mockResolvedValue(3 as never);
        const r = await run("post", "/disable", { body: {} }, "dis-keep");
        expect(r.status).not.toHaveBeenCalled();
        expect(r.json).toHaveBeenCalledWith({
          success: true,
          data: { disabled: true, deletedCandidates: 0, deletedHindsight: 0, cancelledJobs: 3, deleting: false },
        });
      });

      it("deletes in the background, dedupes and releases the lock", async () => {
        vi.mocked(disableTwin).mockResolvedValue(3 as never);
        m.memory["deleteByTag"] = vi.fn().mockResolvedValue(5);
        m.candidate.deleteMany.mockResolvedValue({ count: 2 });
        let r = await run("post", "/disable", { body: { deleteMemories: true } }, "dis-del");
        expect(r.status).toHaveBeenCalledWith(202);
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { disabled: true, deleting: true, cancelledJobs: 3 } });
        r = await run("post", "/disable", { body: { deleteMemories: true } }, "dis-del");
        expect(r.json).toHaveBeenCalledWith({
          success: true,
          data: { disabled: true, deleting: true, cancelledJobs: 3, message: "Delete already running" },
        });
        await flush();
        expect(m.memory["deleteByTag"]).toHaveBeenCalledWith("twin-bank", "user:dis-del");
        expect(m.candidate.deleteMany).toHaveBeenCalledWith({ where: { userId: "dis-del" } });
        expect(m.logger.info).toHaveBeenCalledWith("[digital-twin] disable-delete complete", {
          userId: "dis-del",
          deletedHindsight: 5,
          deletedCandidates: 2,
        });
        r = await run("post", "/disable", { body: { deleteMemories: true } }, "dis-del");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { disabled: true, deleting: true, cancelledJobs: 3 } });
        await flush();
      });

      it("keeps going when the hindsight delete fails, and logs a crash of the row delete", async () => {
        vi.mocked(disableTwin).mockResolvedValue(0 as never);
        m.memory["deleteByTag"] = vi.fn().mockRejectedValue(new Error("hs down"));
        m.candidate.deleteMany.mockRejectedValue(new Error("db down"));
        await run("post", "/disable", { body: { deleteMemories: true } }, "dis-fail");
        await flush();
        expect(m.logger.warn).toHaveBeenCalledWith("[digital-twin] hindsight delete-by-tag failed on disable", {
          userId: "dis-fail",
          err: "hs down",
        });
        expect(m.logger.error).toHaveBeenCalledWith("[digital-twin] disable-delete crashed", { userId: "dis-fail", err: "db down" });
        const r = await run("post", "/disable", { body: { deleteMemories: true } }, "dis-fail");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { disabled: true, deleting: true, cancelledJobs: 0 } });
        await flush();
      });
    });

    describe("POST /clusters/:subsystem/approve", () => {
      const cand = (id: string, extra: Record<string, unknown> = {}) => ({
        id,
        text: `text-${id}`,
        editedText: null,
        sourceRefs: [{ id: `ref-${id}` }],
        pipelineEventId: `p-${id}`,
        ...extra,
      });
      const approve = (userId: string) => run("post", "/clusters/:subsystem/approve", { params: { subsystem: "work" }, body: {} }, userId);

      it("answers 0/0 when nothing is pending, without taking the lock", async () => {
        m.candidate.findMany.mockResolvedValue([]);
        const r = await approve("ca-empty");
        expect(r.status).not.toHaveBeenCalled();
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { approved: 0, retained: 0 } });
        expect(ensureTwinBank).not.toHaveBeenCalled();
      });

      it("filters by candidateIds when given", async () => {
        m.candidate.findMany.mockResolvedValue([]);
        await run("post", "/clusters/:subsystem/approve", { params: { subsystem: "work" }, body: { candidateIds: ["a", "b"] } }, "ca-ids");
        expect(m.candidate.findMany).toHaveBeenCalledWith({
          where: { userId: "ca-ids", subsystem: "work", status: "pending", id: { in: ["a", "b"] } },
        });
        m.candidate.findMany.mockClear();
        await run("post", "/clusters/:subsystem/approve", { params: { subsystem: "work" }, body: { candidateIds: [] } }, "ca-ids");
        expect(m.candidate.findMany).toHaveBeenCalledWith({ where: { userId: "ca-ids", subsystem: "work", status: "pending" } });
      });

      it("retains each candidate in the background, dedupes and releases the lock", async () => {
        m.candidate.findMany.mockResolvedValue([cand("c1"), cand("c2", { editedText: "edited" }), cand("c3")]);
        vi.mocked(retainTwinMemory).mockResolvedValueOnce("m1" as never).mockResolvedValueOnce("m2" as never).mockRejectedValueOnce(new Error("hs"));
        let r = await approve("ca-ok");
        expect(r.status).toHaveBeenCalledWith(202);
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { processing: true, count: 3, subsystem: "work" } });
        r = await approve("ca-ok");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { processing: true, message: "Cluster approval already running" } });
        expect(ensureTwinBank).not.toHaveBeenCalled();
        await flush();
        expect(ensureTwinBank).toHaveBeenCalledTimes(1);
        expect(vi.mocked(retainTwinMemory).mock.calls.map((c) => c[0])).toEqual([
          { userId: "ca-ok", subsystem: "work", content: "text-c1", sourceRefs: [{ id: "ref-c1" }], pipelineEventId: "p-c1" },
          { userId: "ca-ok", subsystem: "work", content: "edited", sourceRefs: [{ id: "ref-c2" }], pipelineEventId: "p-c2" },
          { userId: "ca-ok", subsystem: "work", content: "text-c3", sourceRefs: [{ id: "ref-c3" }], pipelineEventId: "p-c3" },
        ]);
        expect(m.candidate.update.mock.calls.map((c) => c[0])).toEqual([
          { where: { id: "c1" }, data: { status: "approved", approvedAt: new Date("2026-03-15T12:00:00.000Z"), hindsightMemoryId: "m1" } },
          { where: { id: "c2" }, data: { status: "approved", approvedAt: new Date("2026-03-15T12:00:00.000Z"), hindsightMemoryId: "m2" } },
        ]);
        expect(m.logger.warn).toHaveBeenCalledWith("[digital-twin] retain failed for candidate", {
          userId: "ca-ok",
          subsystem: "work",
          candidateId: "c3",
          err: "hs",
        });
        expect(m.logger.info).toHaveBeenCalledWith("[digital-twin] cluster approve complete", {
          userId: "ca-ok",
          subsystem: "work",
          retained: 2,
          failed: 1,
        });
        r = await approve("ca-ok");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { processing: true, count: 3, subsystem: "work" } });
        await flush();
      });
    });

    describe("POST /pipeline/events/:id/retry", () => {
      const event = (extra: Record<string, unknown> = {}) => ({
        id: "ev1",
        sourceKind: "calls",
        status: "error",
        windowFrom: new Date("2026-03-01T00:00:00Z"),
        windowTo: new Date("2026-03-02T00:00:00Z"),
        ...extra,
      });
      const window = { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-02T00:00:00Z") };
      const retry = (userId: string, id = "ev1") => run("post", "/pipeline/events/:id/retry", { params: { id } }, userId);

      it("404s an unknown event and 400s runs that cannot be retried", async () => {
        m.event.findFirst.mockResolvedValue(null);
        let r = await retry("rt-check");
        expect(m.event.findFirst).toHaveBeenCalledWith({
          where: { id: "ev1", userId: "rt-check" },
          select: { id: true, sourceKind: true, status: true, windowFrom: true, windowTo: true },
        });
        expect(r.status).toHaveBeenCalledWith(404);
        expect(r.json).toHaveBeenCalledWith({ success: false, error: "Event not found" });
        m.event.findFirst.mockResolvedValue(event({ sourceKind: null }));
        r = await retry("rt-check");
        expect(r.status).toHaveBeenCalledWith(400);
        expect(r.json).toHaveBeenCalledWith({ success: false, error: "This run has no source window to retry" });
        m.event.findFirst.mockResolvedValue(event({ status: "ok" }));
        r = await retry("rt-check");
        expect(r.status).toHaveBeenCalledWith(400);
        expect(r.json).toHaveBeenCalledWith({ success: false, error: "Only failed or empty runs can be retried" });
        expect(fetchSourceRecords).not.toHaveBeenCalled();
      });

      it("re-curates the window in the background, dedupes and releases the lock", async () => {
        m.event.findFirst.mockResolvedValue(event());
        vi.mocked(fetchSourceRecords).mockResolvedValue([{ id: "r1" }] as never);
        vi.mocked(curateRecordsInBatches).mockResolvedValue(undefined as never);
        let r = await retry("rt-ok");
        expect(r.status).toHaveBeenCalledWith(202);
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "started" } });
        r = await retry("rt-ok");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "already-running" } });
        expect(fetchSourceRecords).not.toHaveBeenCalled();
        await flush();
        expect(fetchSourceRecords).toHaveBeenCalledTimes(1);
        expect(fetchSourceRecords).toHaveBeenCalledWith("calls", "rt-ok", window);
        expect(curateRecordsInBatches).toHaveBeenCalledWith({
          userId: "rt-ok",
          window,
          records: [{ id: "r1" }],
          source: "retry:2026-03-15:calls",
        });
        expect(recordPipelineEvent).not.toHaveBeenCalled();
        r = await retry("rt-ok");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "started" } });
        await flush();
      });

      it("records an empty event when the window is still bare", async () => {
        m.event.findFirst.mockResolvedValue(event({ status: "empty" }));
        vi.mocked(fetchSourceRecords).mockResolvedValue([] as never);
        await retry("rt-empty");
        await flush();
        expect(curateRecordsInBatches).not.toHaveBeenCalled();
        expect(recordPipelineEvent).toHaveBeenCalledWith({
          userId: "rt-empty",
          source: "retry:2026-03-15:calls",
          window,
          status: "empty",
          recordCount: 0,
        });
      });

      it("logs a failure, records an error event and releases the lock", async () => {
        m.event.findFirst.mockResolvedValue(event());
        vi.mocked(fetchSourceRecords).mockRejectedValue(new Error("fetch boom"));
        await retry("rt-fail");
        await flush();
        expect(m.logger.warn).toHaveBeenCalledWith("[digital-twin] pipeline retry failed", {
          userId: "rt-fail",
          eventId: "ev1",
          err: "fetch boom",
        });
        expect(recordPipelineEvent).toHaveBeenCalledWith({
          userId: "rt-fail",
          source: "retry:2026-03-15:calls",
          window,
          status: "error",
          recordCount: 0,
          error: "fetch boom",
        });
        const r = await retry("rt-fail");
        expect(r.json).toHaveBeenCalledWith({ success: true, data: { status: "started" } });
        await flush();
      });
    });
  });
});
