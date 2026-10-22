import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
  published: [] as string[],
  breakGlass: null as string | null,
  nextId: 1,
}));

const tx = {
  killSwitch: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `k${state.nextId++}`, clearedAt: null, expiresAt: null, createdAt: new Date(), ...data }; state.rows.push(row); return row; }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.rows.find((r) => r["id"] === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = state.rows.find((r) => r["id"] === where.id)!; Object.assign(row, data); return row; }),
  },
  governanceAuditEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.audit.push(data); return data; }) },
};
vi.mock("../db.js", () => ({
  governancePrisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    killSwitch: {
      findMany: vi.fn(async () => state.rows.filter((r) => r["clearedAt"] === null && (r["expiresAt"] === null || (r["expiresAt"] as Date) > new Date()))),
      findFirst: vi.fn(async () => { const epochs = state.rows.map((r) => r["epoch"] as bigint); return epochs.length ? { epoch: epochs.reduce((a, b) => (b > a ? b : a)) } : null; }),
    },
  },
}));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({ publish: vi.fn(async (_c: string, m: string) => { state.published.push(m); return 1; }), get: vi.fn(async () => state.breakGlass) }), getRedisConfig: () => ({}) } }));
vi.mock("ioredis", () => ({ Redis: class { on() { return this; } subscribe() { return Promise.resolve(); } quit() { return Promise.resolve(); } disconnect() { /* */ } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const { clearKillSwitch, currentKillEpoch, currentKillSnapshot, killForAdmission, killForTool, parseBreakGlass, refreshKillSnapshot, setKillSnapshotForTests, setKillSwitch, signBreakGlass } = await import("./governance-kill.js");
const { governancePrisma } = await import("../db.js");
const { resetComponentModes } = await import("xyne-claw-shared/governance");

beforeEach(() => {
  state.rows.length = state.audit.length = state.published.length = 0;
  state.breakGlass = null;
  state.nextId = 1;
  setKillSnapshotForTests({ epoch: 0, takenAtMs: 0, switches: [] });
  delete process.env["GOVERNANCE_COMPONENT_MODES"];
  delete process.env["GOVERNANCE_BREAK_GLASS_KEY"];
  resetComponentModes();
});

describe("kill switches", () => {
  it("writes the row and its audit event together, moves the epoch, publishes and refreshes the snapshot", async () => {
    const set = await setKillSwitch({ orgId: "org-1", scopeKind: "agent", scopeId: "helper", mode: "stop", reason: "leaking", actor: { kind: "admin", userId: "admin-1" } });
    expect(state.rows[0]).toMatchObject({ scopeKind: "agent", scopeId: "helper", mode: "stop", setBy: "admin", setByUserId: "admin-1", epoch: BigInt(set.epoch) });
    expect(state.audit[0]).toMatchObject({ eventType: "kill_switch_set", orgId: "org-1", actorKind: "admin", actorId: "admin-1", subjectKind: "kill:agent", subjectId: "helper", reasonCode: "GOV-KILL-STOP", approvalId: set.id });
    expect(JSON.parse(state.published[0]!)).toMatchObject({ epoch: set.epoch });
    expect(currentKillSnapshot()).toMatchObject({ epoch: set.epoch, switches: [{ scopeKind: "agent", scopeId: "helper", mode: "stop", reason: "leaking" }] });
    expect(killForAdmission({ orgId: "org-1", agentSlug: "helper", userId: "u1" })).toMatchObject({ mode: "stop" });
    expect(killForAdmission({ orgId: "org-1", agentSlug: "other", userId: "u1" })).toBeNull();

    const cleared = await clearKillSwitch(set.id, { kind: "admin", userId: "admin-2" }, "fixed");
    expect(cleared!.epoch).toBeGreaterThanOrEqual(set.epoch);
    expect(state.rows[0]).toMatchObject({ clearedByUserId: "admin-2", clearReason: "fixed" });
    expect(state.audit[1]).toMatchObject({ eventType: "kill_switch_cleared", actorId: "admin-2" });
    expect(currentKillSnapshot().switches).toEqual([]);
    expect(await clearKillSwitch(set.id, { kind: "admin", userId: "admin-2" }, "again")).toBeNull();
  });

  it("refuses a switch without a reason, a bad scope or a bad mode", async () => {
    await expect(setKillSwitch({ orgId: "o", scopeKind: "agent", scopeId: "a", mode: "stop", reason: " ", actor: { kind: "admin" } })).rejects.toThrow(/reason/);
    await expect(setKillSwitch({ orgId: "o", scopeKind: "galaxy" as never, scopeId: "a", mode: "stop", reason: "x", actor: { kind: "admin" } })).rejects.toThrow(/scope/);
    await expect(setKillSwitch({ orgId: "o", scopeKind: "agent", scopeId: "a", mode: "pause" as never, reason: "x", actor: { kind: "admin" } })).rejects.toThrow(/mode/);
  });

  it("matches server and tool scopes for runner.callTool, and admission only refuses on stop", async () => {
    await setKillSwitch({ orgId: "org-1", scopeKind: "mcp_server", scopeId: "slack", mode: "read_only", reason: "incident", actor: { kind: "admin", userId: "a" } });
    await setKillSwitch({ orgId: "org-1", scopeKind: "tool", scopeId: "delete_channel", mode: "stop", reason: "never", actor: { kind: "admin", userId: "a" } });
    expect(killForTool("slack", "list_channels")).toMatchObject({ mode: "read_only" });
    expect(killForTool("slack", "delete_channel")).toMatchObject({ mode: "stop" });
    expect(killForTool("jira", "get_issue")).toBeNull();
    await setKillSwitch({ orgId: "org-1", scopeKind: "org", scopeId: "org-1", mode: "ask_all", reason: "review", actor: { kind: "admin", userId: "a" } });
    expect(killForAdmission({ orgId: "org-1", userId: "u" })).toBeNull();
    process.env["GOVERNANCE_COMPONENT_MODES"] = "kill=off";
    resetComponentModes();
    expect(killForTool("slack", "delete_channel")).toBeNull();
  });

  it("joins a signed break-glass entry to the snapshot and ignores a forged one", async () => {
    process.env["GOVERNANCE_BREAK_GLASS_KEY"] = "k".repeat(32);
    const switches = [{ scopeKind: "platform" as const, scopeId: "*", mode: "stop" as const, epoch: 1, reason: "postgres down" }];
    state.breakGlass = JSON.stringify({ switches, sig: signBreakGlass(switches, "k".repeat(32)) });
    await refreshKillSnapshot();
    expect(currentKillSnapshot().switches).toEqual([expect.objectContaining({ scopeKind: "platform", mode: "stop" })]);
    expect(killForAdmission({ orgId: "any", userId: "u" })).toMatchObject({ scopeKind: "platform" });
    expect(parseBreakGlass(JSON.stringify({ switches, sig: "0".repeat(64) }), "k".repeat(32), Date.now())).toEqual([]);
    expect(parseBreakGlass(state.breakGlass, undefined, Date.now())).toEqual([]);
  });

  it("moves the epoch for a break-glass entry and keeps serving it while Postgres is away", async () => {
    process.env["GOVERNANCE_BREAK_GLASS_KEY"] = "k".repeat(32);
    await setKillSwitch({ orgId: "org-1", scopeKind: "agent", scopeId: "helper", mode: "read_only", reason: "x", actor: { kind: "admin", userId: "a" } });
    const before = currentKillSnapshot().epoch;
    const switches = [{ scopeKind: "org" as const, scopeId: "org-9", mode: "stop" as const, epoch: before + 1000, reason: "postgres down" }];
    state.breakGlass = JSON.stringify({ switches, sig: signBreakGlass(switches, "k".repeat(32)) });
    expect(await currentKillEpoch()).toBe(before + 1000);
    vi.mocked(governancePrisma.killSwitch.findMany).mockRejectedValueOnce(new Error("connection refused"));
    vi.mocked(governancePrisma.killSwitch.findFirst).mockRejectedValueOnce(new Error("connection refused"));
    const snap = await refreshKillSnapshot();
    expect(snap.epoch).toBe(before + 1000);
    expect(Date.now() - snap.takenAtMs).toBeLessThan(1_000);
    expect(snap.switches.map((s) => `${s.scopeKind}=${s.scopeId}`)).toEqual(["agent=helper", "org=org-9"]);
  });
});
