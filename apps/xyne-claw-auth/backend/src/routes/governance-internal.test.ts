import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const record = vi.fn(async (e: Record<string, unknown>) => e);
const queue = vi.fn();
const createFindings = vi.fn(async (rows: Record<string, unknown>[]) => rows.map((_, i) => ({ id: `f${i}` })));
vi.mock("../lib/governance-audit.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/governance-audit.js")>()),
  recordGovernanceEvent: record,
  queueGovernanceEvent: queue,
  governanceQueueStats: () => ({ pending: 0, dropped: 2 }),
}));
vi.mock("../repositories/governanceRepository.js", () => ({
  contentScanFindingRepository: { createMany: createFindings },
  governanceAuditEventRepository: {},
}));
vi.mock("../services/storageService.js", () => ({ gcsService: { uploadFile: vi.fn() } }));
vi.mock("../lib/governance-gate.js", () => ({ runContextForSession: vi.fn(async (sessionId?: string) => (sessionId === "sess-1" ? { runId: "run-1", orgId: "org-run", conversationId: "conv-1" } : {})) }));
vi.mock("../lib/audit.js", () => ({ orgIdForUser: vi.fn(async (id: string) => (id === "u1" ? "org-user" : undefined)) }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const { governanceInternalRouter } = await import("./governance-internal.js");

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };
const layer = (governanceInternalRouter as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === "/events" && l.route.methods["post"]);
const handler = layer!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>;

async function post(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  const next = vi.fn();
  // asyncHandler does not return the handler's promise; wait for a response or a forwarded error.
  await handler({ body } as Request, res as unknown as Response, next);
  await vi.waitFor(() => {
    if (res.body === undefined && next.mock.calls.length === 0) throw new Error("still running");
  });
  return { res, next };
}

const write = { orgId: "org-1", eventType: "tool_call", actorKind: "agent", runId: "r1", toolCallId: "c1", toolName: "send_email", toolEffect: "send", decision: "allow" };
const read = { ...write, toolCallId: "c2", toolName: "search", toolEffect: "read" };
const finding = { orgId: "org-1", foundIn: "tool_result", runId: "r1", foundByCheck: "parser", verdict: "suspicious", ruleId: "x.y", score: 0.7, startOffset: 0, endOffset: 5, redactedExcerpt: "hello", scanProfile: "tool_result", scannerVersion: "parser-1+abc" };

beforeEach(() => vi.clearAllMocks());

describe("POST /internal/governance/events", () => {
  it("writes side-effect calls before answering, queues reads and stores findings", async () => {
    const { res } = await post({ events: [write, read, { ...read, toolCallId: "c3", sync: true }], findings: [finding] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { recorded: 2, queued: 1, findings: 1, unplaced: 0, dropped: 2 } });
    expect(record.mock.calls.map((c) => c[0]!["toolCallId"])).toEqual(["c1", "c3"]);
    expect(record.mock.calls[0]![0]).not.toHaveProperty("sync");
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "c2" }));
    expect(createFindings).toHaveBeenCalledWith([expect.objectContaining({ ruleId: "x.y", verdict: "suspicious" })]);
  });

  it("places claw's records by session or user when they carry no org", async () => {
    const { res } = await post({ events: [{ ...read, orgId: undefined, runId: undefined, sessionId: "sess-1", userId: "u1" }, { ...read, orgId: undefined, runId: undefined, userId: "u1", toolCallId: "c9" }, { ...read, orgId: undefined, userId: "nobody" }], findings: [{ ...finding, orgId: undefined, sessionId: "sess-1" }] });
    expect(res.body).toMatchObject({ success: true, data: { queued: 2, findings: 1, unplaced: 1 } });
    expect(queue.mock.calls.map((c) => [c[0]!["orgId"], c[0]!["runId"], c[0]!["conversationId"], c[0]!["onBehalfOfUserId"]])).toEqual([["org-run", "run-1", "conv-1", "u1"], ["org-user", null, null, "u1"]]);
    expect(queue.mock.calls[0]![0]).not.toHaveProperty("sessionId");
    expect(createFindings).toHaveBeenCalledWith([expect.objectContaining({ orgId: "org-run", runId: "r1" })]);
  });

  it("rejects a malformed event instead of storing a partial batch", async () => {
    const { next } = await post({ events: [{ ...write, eventType: "shrug" }] });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    expect(record).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it("answers 503 audit unavailable when a side-effect event cannot be written", async () => {
    record.mockRejectedValueOnce(new Error("connection refused"));
    const { res } = await post({ events: [write, read] });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ success: false, error: "audit unavailable" });
    expect(queue).not.toHaveBeenCalled();
  });
});
