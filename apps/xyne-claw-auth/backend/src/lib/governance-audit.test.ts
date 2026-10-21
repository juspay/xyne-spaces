import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceAuditEvent } from "@prisma/client";

type Row = GovernanceAuditEvent;
const rows: Row[] = [];
let nextId = 1;
const NULLS = Object.fromEntries(
  ["actorId", "onBehalfOfUserId", "actorIp", "actorUserAgent", "subjectKind", "subjectId", "contentSha256Before", "contentSha256After", "agentId",
    "runId", "conversationId", "toolCallId", "mcpServerId", "toolName", "traceId", "spanId", "decision", "reasonCode", "reasonText", "policyVersion",
    "scannerVersion", "checkTierReached", "parserMs", "judgeMs", "gateMs", "outcome", "toolEffect", "destinationKind", "destinationHost",
    "riskLevelAtCall", "carriedPrivateData", "argumentsRedacted", "approvalId"].map((k) => [k, null]),
);
const make = (data: Record<string, unknown>): Row =>
  ({ id: `e${nextId++}`, ...NULLS, matchedRuleIds: [], findingIds: [], loadedVersionIds: [], orgSequence: null, previousRowSha256: null, rowSha256: null, createdAt: new Date(), ...data }) as unknown as Row;
const chainedOf = (orgId: string) => rows.filter((r) => r.orgId === orgId && r.orgSequence !== null).sort((a, b) => a.orgSequence! - b.orgSequence!);

const repo = {
  create: vi.fn(async (data: Record<string, unknown>) => {
    // The partial unique index: one tool_call row per (org, run, tool call id).
    if (data["eventType"] === "tool_call" && rows.some((r) => r.eventType === "tool_call" && r.orgId === data["orgId"] && r.runId === data["runId"] && r.toolCallId === data["toolCallId"])) throw Object.assign(new Error("unique"), { code: "P2002" });
    const r = make(data); rows.push(r); return r;
  }),
  findToolCall: vi.fn(async (orgId: string, runId: string, toolCallId: string) => rows.find((r) => r.eventType === "tool_call" && r.orgId === orgId && r.runId === runId && r.toolCallId === toolCallId) ?? null),
  createMany: vi.fn(async (data: Record<string, unknown>[]) => { for (const d of data) rows.push(make(d)); return { count: data.length }; }),
  orgsWithUnchained: vi.fn(async () => [...new Set(rows.filter((r) => r.orgSequence === null).map((r) => r.orgId))].map((orgId) => ({ orgId }))),
  unchained: vi.fn(async (orgId: string, take: number) =>
    rows.filter((r) => r.orgId === orgId && r.orgSequence === null).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id)).slice(0, take)),
  lastChained: vi.fn(async (orgId: string) => chainedOf(orgId).at(-1) ?? null),
  chain: vi.fn(async (id: string, orgSequence: number, previousRowSha256: string | null, rowSha256: string) => {
    const r = rows.find((x) => x.id === id && x.orgSequence === null);
    if (!r) return { count: 0 };
    if (rows.some((x) => x.orgId === r.orgId && x.orgSequence === orgSequence)) throw new Error("unique (orgId, orgSequence)");
    Object.assign(r, { orgSequence, previousRowSha256, rowSha256 });
    return { count: 1 };
  }),
  chained: vi.fn(async (orgId: string, from: number, take: number) => chainedOf(orgId).filter((r) => r.orgSequence! >= from).slice(0, take)),
};
const upload = vi.fn(async () => undefined);
const auditLogCreate = vi.fn(async () => ({}));
vi.mock("../repositories/governanceRepository.js", () => ({ governanceAuditEventRepository: repo }));
vi.mock("../repositories/auditLogRepository.js", () => ({ auditLogRepository: { create: auditLogCreate } }));
vi.mock("../services/storageService.js", () => ({ gcsService: { uploadFile: upload } }));
vi.mock("../db.js", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ orgId: "org-1" })) }, agent: { findUnique: vi.fn(async () => null) }, organization: { findFirst: vi.fn(async () => null) } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const audit = await import("./governance-audit.js");
const { writeAuditLog } = await import("./audit.js");

const at = (s: number) => new Date(Date.UTC(2026, 9, 21, 0, 0, s));
const event = (orgId: string, s: number, extra: Record<string, unknown> = {}) =>
  ({ orgId, eventType: "tool_call" as const, occurredAt: at(s), actorKind: "agent" as const, toolName: `t${s}`, decision: "allow" as const, ...extra });

beforeEach(async () => {
  rows.length = 0;
  nextId = 1;
  vi.clearAllMocks();
  process.env["GOVERNANCE_CHECKPOINT_KEY"] = "test-key";
  await audit.flushGovernanceEvents();
});

describe("governance audit stream", () => {
  it("writes side-effect events at once, batches the rest and drops the oldest past the cap", async () => {
    await audit.recordGovernanceEvent(event("org-1", 1));
    expect(repo.create).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10_001; i++) audit.queueGovernanceEvent(event("org-1", 2, { toolName: `q${i}` }));
    expect(audit.governanceQueueStats()).toEqual({ pending: 10_000, dropped: 1 });
    expect(await audit.flushGovernanceEvents()).toBe(10_000);
    expect(rows.map((r) => r.toolName).slice(0, 2)).toEqual(["t1", "q1"]);
  });

  it("chains each org in time order and the verifier accepts the chain", async () => {
    await repo.createMany([event("org-2", 5), event("org-1", 3), event("org-1", 1), event("org-1", 2)]);
    expect(await audit.chainPendingEvents("org-1")).toBe(3);
    const chain = chainedOf("org-1");
    expect(chain.map((r) => [r.orgSequence, r.toolName])).toEqual([[1, "t1"], [2, "t2"], [3, "t3"]]);
    expect(chain[0]!.previousRowSha256).toBeNull();
    expect(chain[1]!.previousRowSha256).toBe(chain[0]!.rowSha256);
    expect(chain[2]!.rowSha256).toBe(audit.auditRowSha256(chain[2]!, 3, chain[1]!.rowSha256));
    expect(await audit.verifyAuditChain("org-1")).toEqual({ ok: true, checked: 3, lastSequence: 3, lastRowSha256: chain[2]!.rowSha256 });
    expect(chainedOf("org-2")).toEqual([]);
    // Later rows continue the chain from the stored head.
    await repo.createMany([event("org-1", 4)]);
    await audit.chainPendingEvents("org-1");
    expect(chainedOf("org-1").at(-1)).toMatchObject({ orgSequence: 4, previousRowSha256: chain[2]!.rowSha256 });
  });

  it("catches a tampered row, a broken link and a gap", async () => {
    await repo.createMany([event("org-1", 1), event("org-1", 2), event("org-1", 3)]);
    await audit.chainPendingEvents("org-1");
    const [a, b, c] = chainedOf("org-1") as [Row, Row, Row];
    const decision = b.decision;
    b.decision = "block";
    expect((await audit.verifyAuditChain("org-1")).problem).toEqual({ sequence: 2, kind: "hash_mismatch" });
    b.decision = decision;
    const link = c.previousRowSha256;
    c.previousRowSha256 = a.rowSha256;
    expect((await audit.verifyAuditChain("org-1")).problem).toEqual({ sequence: 3, kind: "previous_mismatch" });
    c.previousRowSha256 = link;
    rows.splice(rows.indexOf(b), 1);
    expect(await audit.verifyAuditChain("org-1")).toMatchObject({ ok: false, checked: 1, problem: { sequence: 3, kind: "gap" } });
  });

  it("stops a batch another pod already chained and restarts from the head next time", async () => {
    await repo.createMany([event("org-1", 1), event("org-1", 2)]);
    repo.chain.mockResolvedValueOnce({ count: 0 });
    expect(await audit.chainPendingEvents("org-1")).toBe(0);
    expect(await audit.chainPendingEvents("org-1")).toBe(2);
  });

  it("signs a checkpoint the verifier can resume from", async () => {
    await repo.createMany([event("org-1", 1), event("org-1", 2)]);
    await audit.chainPendingEvents("org-1");
    const cp = await audit.buildAuditCheckpoint("org-1");
    expect(cp).toMatchObject({ orgId: "org-1", lastSequence: 2, lastRowSha256: chainedOf("org-1")[1]!.rowSha256 });
    const { signature, ...body } = cp!;
    expect(signature).toBe(audit.signCheckpoint(body));
    expect(audit.signCheckpoint({ ...body, lastSequence: 3 })).not.toBe(signature);
    await repo.createMany([event("org-1", 3)]);
    await audit.chainPendingEvents("org-1");
    expect(await audit.verifyAuditChain("org-1", cp!.lastSequence + 1, cp!.lastRowSha256)).toMatchObject({ ok: true, checked: 1, lastSequence: 3 });
  });

  it("mirrors every legacy audit write into the stream with the actor's org", async () => {
    await writeAuditLog({ actorUserId: "u1", eventType: "AGENT_UPDATED", targetId: "agent-1", description: "renamed" });
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", targetId: "agent-1" }));
    await audit.flushGovernanceEvents();
    expect(rows[0]).toMatchObject({ orgId: "org-1", eventType: "config_changed", actorKind: "user", actorId: "u1", subjectKind: "AGENT_UPDATED", subjectId: "agent-1", reasonText: "renamed" });
  });
});

describe("exactly once", () => {
  it("writes one row for a tool call however many times it is recorded at once", async () => {
    const e = { orgId: "org-1", eventType: "tool_call" as const, runId: "run-1", toolCallId: "call-1", toolName: "send", toolEffect: "send", decision: "allow" };
    const results = await Promise.all(Array.from({ length: 50 }, () => audit.recordGovernanceEvent(e)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(rows.filter((r) => r.eventType === "tool_call" && r.toolCallId === "call-1")).toHaveLength(1);
  });
});
