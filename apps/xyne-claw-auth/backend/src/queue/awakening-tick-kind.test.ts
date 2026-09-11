import { describe, expect, it } from "vitest";
import { resolveAwakeningConfig, participatesIn } from "../awakening/config.js";

/**
 * Regression guard for the bug where the heartbeat tick cleared
 * `state.enabled` for any agent that did not do heartbeats — which silently
 * killed every reflex-only agent, because the reflex claim scan requires
 * `enabled = TRUE`.
 *
 * The tick worker itself needs Redis + Prisma to exercise, so this pins the
 * predicate the fix keys off: `enabled` and "participates in this kind" are
 * two different questions and must never be collapsed.
 */
describe("wake-kind participation", () => {
  const cfg = (kind: string) => resolveAwakeningConfig({ awakening: { enabled: true, kind } });

  it("reflex-only agents do not participate in heartbeat", () => {
    expect(participatesIn(cfg("reflex"), "heartbeat")).toBe(false);
  });

  it("reflex-only agents are still ENABLED — the reflex scan needs that", () => {
    expect(cfg("reflex").enabled).toBe(true);
    expect(participatesIn(cfg("reflex"), "reflex")).toBe(true);
  });

  it("heartbeat-only agents do not participate in reflex but stay enabled", () => {
    expect(participatesIn(cfg("heartbeat"), "reflex")).toBe(false);
    expect(cfg("heartbeat").enabled).toBe(true);
  });

  it("both participates in each kind", () => {
    expect(participatesIn(cfg("both"), "heartbeat")).toBe(true);
    expect(participatesIn(cfg("both"), "reflex")).toBe(true);
  });

  it("a disabled agent is disabled regardless of kind", () => {
    const off = resolveAwakeningConfig({ awakening: { enabled: false, kind: "both" } });
    expect(off.enabled).toBe(false);
  });
});
