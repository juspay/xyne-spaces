import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ governancePrisma: {}, prisma: {} }));
vi.mock("../lib/governance-kill.js", () => ({ KILL_MODES: ["stop", "read_only", "ask_all"], clearKillSwitch: vi.fn(), listKillSwitches: vi.fn(), setKillSwitch: vi.fn() }));
vi.mock("../middleware/require-auth.js", () => ({ s2sKeyMatches: vi.fn(() => false) }));
vi.mock("../middleware/agent-acl.js", () => ({ getOrgId: vi.fn(), requireRequester: vi.fn() }));
vi.mock("../lib/admin-org-scope.js", () => ({ getAdminOrgScope: vi.fn() }));

const { eventsWhere } = await import("./admin-governance.js");

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
