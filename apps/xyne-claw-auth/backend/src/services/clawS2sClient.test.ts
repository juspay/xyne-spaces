import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { xyneClawS2sKey: "s2s-secret", xyneClawUrl: "http://claw.test/" } as { xyneClawS2sKey: string; xyneClawUrl: string },
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../config.js", () => ({ CONFIG: mocks.config }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ warn: mocks.loggerWarn, info: vi.fn(), error: mocks.loggerError, debug: vi.fn() }),
  createTraceId: () => "trace",
}));

import { clawUrl, postToClaw } from "./clawS2sClient.js";
import { judgeGoalViaClaw } from "./goalJudgeClient.js";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  mocks.config.xyneClawS2sKey = "s2s-secret";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("postToClaw", () => {
  it("joins the URL without a double slash", () => {
    expect(clawUrl("/goal-judge")).toBe("http://claw.test/goal-judge");
    expect(clawUrl("goal-judge")).toBe("http://claw.test/goal-judge");
  });

  it("refuses without an S2S key and makes no request", async () => {
    mocks.config.xyneClawS2sKey = "";
    const fetchImpl = vi.fn();
    const r = await postToClaw("/x", {}, { timeoutMs: 1000, fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: "no-key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the S2S header and JSON body, and returns parsed data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { a: 1 }));
    const r = await postToClaw("/x", { q: "hi" }, { timeoutMs: 1000, fetchImpl });
    expect(r).toEqual({ ok: true, data: { a: 1 } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://claw.test/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-s2s-key": "s2s-secret" });
    expect(init.body).toBe(JSON.stringify({ q: "hi" }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps non-2xx to kind=http with a truncated body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("x".repeat(500), { status: 503 }));
    const r = await postToClaw("/x", {}, { timeoutMs: 1000, fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: "http", status: 503 });
    if (!r.ok && r.kind === "http") expect(r.body).toHaveLength(200);
  });

  it("maps network errors and bad JSON to kind=error without throwing", async () => {
    const down = await postToClaw("/x", {}, { timeoutMs: 1000, fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
    expect(down).toMatchObject({ ok: false, kind: "error", error: "ECONNREFUSED" });
    const garbage = await postToClaw("/x", {}, { timeoutMs: 1000, fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, "not json{")) });
    expect(garbage).toMatchObject({ ok: false, kind: "error" });
  });
});

describe("judgeGoalViaClaw (fail-closed contract)", () => {
  const req = { condition: "tests pass", lastTurnOutput: "done", turnCount: 1, maxTurns: 5 };
  const unavailable = { done: false, reason: "judge_unavailable" };

  it("returns the judge's decision on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { success: true, done: true, reason: "completed: ok" })));
    await expect(judgeGoalViaClaw(req)).resolves.toEqual({ done: true, reason: "completed: ok" });
  });

  it.each([
    ["missing key", () => { mocks.config.xyneClawS2sKey = ""; return vi.fn(); }],
    ["HTTP 500", () => vi.fn().mockResolvedValue(jsonResponse(500, "boom"))],
    ["network error", () => vi.fn().mockRejectedValue(new Error("timeout"))],
    ["malformed body", () => vi.fn().mockResolvedValue(jsonResponse(200, { success: true, done: "yes" }))],
    ["success=false", () => vi.fn().mockResolvedValue(jsonResponse(200, { success: false, done: true, reason: "x" }))],
    ["null body", () => vi.fn().mockResolvedValue(jsonResponse(200, "null"))],
  ])("returns judge_unavailable on %s", async (_name, makeFetch) => {
    vi.stubGlobal("fetch", makeFetch());
    await expect(judgeGoalViaClaw(req)).resolves.toEqual(unavailable);
  });
});
