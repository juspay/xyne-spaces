import { describe, expect, it, vi, beforeEach } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("./webhook.js", () => ({ getSession: getSessionMock }));

const { withSurfaceDefaultToolsConfig } = await import("./mcp.js");

const baseConfig = { direct: ["spaces-search", "spaces-messages"], custom: [], subagents: [] };

beforeEach(() => getSessionMock.mockReset());

/**
 * An awakened run has no thread its final answer is posted into, so the
 * bot-identity send tool is the ONLY way it can speak. It never appears in the
 * agent tool picker, so every configured agent's strict `direct` allowlist
 * excludes it — and the run goes silent. Observed live 2026-08-25.
 */
describe("withSurfaceDefaultToolsConfig — awakened runs", () => {
  for (const kind of ["heartbeat", "reflex"]) {
    it(`grants apps-send-message on a ${kind} run`, async () => {
      getSessionMock.mockResolvedValue({ triggerSource: kind, isAutomation: true, spacesAppId: "a", spacesAppUserId: "u" });
      const out = await withSurfaceDefaultToolsConfig(baseConfig as never, "sess", "app");
      expect(out?.direct).toContain("apps-send-message");
    });
  }

  it("does NOT grant it on an interactive Spaces run", async () => {
    getSessionMock.mockResolvedValue({ triggerSource: "spaces", spacesAppId: "a", spacesAppUserId: "u" });
    const out = await withSurfaceDefaultToolsConfig(baseConfig as never, "sess", "app");
    expect(out?.direct).not.toContain("apps-send-message");
  });

  it("does NOT grant it on a scheduled run", async () => {
    getSessionMock.mockResolvedValue({ triggerSource: "scheduled", spacesAppId: "a", spacesAppUserId: "u" });
    const out = await withSurfaceDefaultToolsConfig(baseConfig as never, "sess", "app");
    expect(out?.direct).not.toContain("apps-send-message");
  });

  it("keeps every tool the agent already had", async () => {
    getSessionMock.mockResolvedValue({ triggerSource: "reflex", isAutomation: true, spacesAppId: "a", spacesAppUserId: "u" });
    const out = await withSurfaceDefaultToolsConfig(baseConfig as never, "sess", "app");
    expect(out?.direct).toEqual(expect.arrayContaining(["spaces-search", "spaces-messages"]));
  });

  it("is idempotent when the tool is already allowed", async () => {
    getSessionMock.mockResolvedValue({ triggerSource: "reflex", isAutomation: true, spacesAppId: "a", spacesAppUserId: "u" });
    const cfg = { ...baseConfig, direct: [...baseConfig.direct, "apps-send-message"] };
    const out = await withSurfaceDefaultToolsConfig(cfg as never, "sess", "app");
    expect((out?.direct ?? []).filter((t: string) => t === "apps-send-message")).toHaveLength(1);
  });

  it("does not mutate the stored config object", async () => {
    getSessionMock.mockResolvedValue({ triggerSource: "reflex", isAutomation: true, spacesAppId: "a", spacesAppUserId: "u" });
    const cfg = { direct: ["spaces-search"], custom: [], subagents: [] };
    await withSurfaceDefaultToolsConfig(cfg as never, "sess", "app");
    expect(cfg.direct).toEqual(["spaces-search"]);
  });
});
