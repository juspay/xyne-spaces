import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("../db.js", () => ({ governancePrisma: { governanceAuditEvent: { findMany } }, prisma: {} }));
vi.mock("../lib/governance-kill.js", () => ({ KILL_MODES: ["stop", "read_only", "ask_all"], clearKillSwitch: vi.fn(), currentKillSnapshot: vi.fn(() => ({ epoch: 0, takenAtMs: 0, switches: [] })), listKillSwitches: vi.fn(), setKillSwitch: vi.fn() }));
vi.mock("../config.js", () => ({ CONFIG: { xyneClawUrl: "http://claw.test", xyneClawS2sKey: "k" } }));
vi.mock("../middleware/require-auth.js", () => ({ s2sKeyMatches: vi.fn(() => false) }));
vi.mock("../middleware/agent-acl.js", () => ({ getOrgId: vi.fn(), requireRequester: vi.fn() }));
vi.mock("../lib/admin-org-scope.js", () => ({ getAdminOrgScope: vi.fn() }));

const { criticsFor, eventsWhere } = await import("./admin-governance.js");

describe("criticsFor", () => {
  it("joins the latest shadow critic verdict to each tool call in the page, within the page's time window", async () => {
    const at = new Date("2026-10-22T10:00:00Z");
    findMany.mockResolvedValueOnce([{ toolCallId: "c1", decision: "ask", reasonCode: "GOV-CRITIC-HIGH", matchedRuleIds: ["critic.xor.high"], judgeMs: 600, occurredAt: at }, { toolCallId: "c1", decision: "allow", reasonCode: "GOV-ALLOW", matchedRuleIds: ["critic.xor.low"], judgeMs: 300, occurredAt: new Date(at.getTime() + 1) }]);
    const m = await criticsFor([{ eventType: "tool_call", toolCallId: "c1", occurredAt: at }, { eventType: "tool_call", toolCallId: null, occurredAt: at }], "org-1");
    expect(m.get("c1")).toMatchObject({ reasonCode: "GOV-ALLOW" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", eventType: "critic_verdict", toolCallId: { in: ["c1"] }, occurredAt: { gte: new Date(at.getTime() - 60_000), lte: new Date(at.getTime() + 600_000) } }) }));
    expect((await criticsFor([{ eventType: "tool_outcome", toolCallId: "c2", occurredAt: at }], undefined)).size).toBe(0);
  });
});

describe("eventsWhere", () => {
  it("defaults to the last week of tool calls in the admin's org and maps every filter to its column", () => {
    const w = eventsWhere({}, "org-1");
    expect(w).toMatchObject({ orgId: "org-1", eventType: "tool_call" });
    expect((w.occurredAt as { gte: Date }).gte.getTime()).toBeGreaterThan(Date.now() - 8 * 24 * 60 * 60_000);
    expect(eventsWhere({ decision: "block", risk: "high", effect: "send", outcome: "error", server: "slack", agent: "helper", user: "u1", runId: "r1", tool: "Send", eventType: "tool_outcome", since: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z" }, undefined)).toEqual({
      eventType: "tool_outcome",
      occurredAt: { gte: new Date("2026-10-01T00:00:00Z"), lte: new Date("2026-10-02T00:00:00Z") },
      decision: "block", riskLevelAtCall: "high", toolEffect: "send", outcome: "error", mcpServerId: "slack", actorId: "helper", onBehalfOfUserId: "u1", runId: "r1",
      toolName: { contains: "Send", mode: "insensitive" },
    });
    expect(eventsWhere({ since: "not a date", decision: " " }, "org-2")).not.toHaveProperty("decision");
  });
});
