import { beforeEach, describe, expect, it, vi } from "vitest";

const queued: Array<Record<string, unknown>> = [];
vi.mock("../src/governance-client.js", () => ({ queueGovernance: vi.fn((e: Record<string, unknown>) => { queued.push(e); }), recordGovernanceNow: vi.fn(async () => true), flushGovernance: vi.fn(async () => undefined), governanceClientStats: () => ({ queued: 0, dropped: 0, failed: 0 }) }));
vi.mock("../src/run-control.js", () => ({ registerKillMessageHandler: vi.fn(), startRunControlSubscriber: vi.fn() }));
vi.mock("../src/config.js", () => ({ SERVER: { authServiceUrl: "http://auth.test", s2sKey: "k" }, LITELLM: {}, PATHS: { dataDir: "/tmp" } }));

const { applyKillSnapshot, currentKillSnapshot, refreshKillSnapshot, registerKillableRuns, setKillSnapshotForTests } = await import("../src/governance-kill.js");
const { resetComponentModes } = await import("xyne-claw-shared/governance");

const run = (sessionId: string, over: Record<string, unknown> = {}) => {
  const aborted: string[] = [];
  return { sessionId, userId: "u1", agentSlug: "helper", orgId: "org-1", abort: (reason: string) => { aborted.push(reason); }, aborted, ...over };
};

beforeEach(() => {
  queued.length = 0;
  setKillSnapshotForTests({ epoch: 0, takenAtMs: 0, switches: [] });
  delete process.env["GOVERNANCE_COMPONENT_MODES"];
  resetComponentModes();
});

describe("kill snapshot on a claw pod", () => {
  it("aborts the runs a stop switch matches in enforce mode, once per epoch, and only records in shadow", () => {
    const a = run("s-a");
    const b = run("s-b", { agentSlug: "other" });
    const c = run("s-c", { agentSlug: "other", orgId: "org-2" });
    setKillSnapshotForTests({ epoch: 7, takenAtMs: Date.now(), switches: [{ scopeKind: "agent", scopeId: "helper", mode: "stop", epoch: 7, reason: "leaking" }, { scopeKind: "org", scopeId: "org-1", mode: "read_only", epoch: 7 }] });
    expect(applyKillSnapshot([a, b, c])).toBe(1);
    expect(a.aborted).toEqual([]);
    expect(queued[0]).toMatchObject({ eventType: "kill_switch_enforced", sessionId: "s-a", subjectKind: "kill:agent", subjectId: "helper", reasonCode: "GOV-KILL-STOP", reasonText: expect.stringContaining("shadow: would abort") });
    expect(applyKillSnapshot([a, b, c])).toBe(0);
    process.env["GOVERNANCE_COMPONENT_MODES"] = "kill=enforce";
    resetComponentModes();
    setKillSnapshotForTests({ epoch: 8, takenAtMs: Date.now(), switches: [{ scopeKind: "org", scopeId: "org-1", mode: "stop", epoch: 8, reason: "incident" }] });
    expect(applyKillSnapshot([a, b, c])).toBe(2);
    expect(a.aborted).toEqual(["GOV-KILL-STOP (org=org-1): incident"]);
    expect(b.aborted).toHaveLength(1);
    expect(c.aborted).toEqual([]);
  });

  it("polls the epoch and fetches the snapshot only when it moved, then applies it to the registered runs", async () => {
    const r = run("s-1");
    registerKillableRuns(() => [r]);
    process.env["GOVERNANCE_COMPONENT_MODES"] = "kill=enforce";
    resetComponentModes();
    const calls: string[] = [];
    let epoch = 3;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url.split("/").at(-1)!);
      const body = url.endsWith("/epoch") ? { epoch } : { epoch, takenAtMs: 0, switches: [{ scopeKind: "run", scopeId: "s-1", mode: "stop", epoch, reason: "by hand" }] };
      return { ok: true, json: async () => ({ success: true, data: body }) };
    }));
    try {
      await refreshKillSnapshot(true);
      expect(currentKillSnapshot()).toMatchObject({ epoch: 3, switches: [{ scopeId: "s-1" }] });
      expect(r.aborted).toEqual(["GOV-KILL-STOP (run=s-1): by hand"]);
      await refreshKillSnapshot(false);
      expect(calls).toEqual(["snapshot", "epoch"]);
      epoch = 4;
      await refreshKillSnapshot(false);
      expect(calls).toEqual(["snapshot", "epoch", "epoch", "snapshot"]);
      expect(currentKillSnapshot().epoch).toBe(4);
    } finally {
      vi.unstubAllGlobals();
      registerKillableRuns(null);
    }
  });

  it("keeps the old snapshot when claw-auth is unreachable", async () => {
    setKillSnapshotForTests({ epoch: 2, takenAtMs: 1, switches: [] });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    try {
      await refreshKillSnapshot(false);
      expect(currentKillSnapshot()).toMatchObject({ epoch: 2, takenAtMs: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
