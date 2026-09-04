import { describe, expect, it } from "vitest";
import { isAgentOwnedRun } from "./agent-owned-runs.js";

/**
 * The cross-user redaction exists to protect a HUMAN's private Spaces data in
 * a tool result. An awakened run has no human owner — it runs as the agent's
 * own bot identity — so the redaction protects nobody and only blinds the
 * admin who has to decide whether to take the agent out of shadow mode.
 */
describe("isAgentOwnedRun", () => {
  it("is true for the unattended wake kinds", () => {
    expect(isAgentOwnedRun("heartbeat")).toBe(true);
    expect(isAgentOwnedRun("reflex")).toBe(true);
  });

  it("is false for every human-triggered source — those stay redacted", () => {
    for (const src of ["spaces", "chat", "api", "slack", "automation", "scheduled"]) {
      expect(isAgentOwnedRun(src)).toBe(false);
    }
  });

  it("fails closed on a missing or unknown source", () => {
    expect(isAgentOwnedRun(undefined)).toBe(false);
    expect(isAgentOwnedRun(null)).toBe(false);
    expect(isAgentOwnedRun("")).toBe(false);
    expect(isAgentOwnedRun("something-new")).toBe(false);
  });

  it("is exact, not a prefix match", () => {
    expect(isAgentOwnedRun("heartbeat-x")).toBe(false);
    expect(isAgentOwnedRun("Heartbeat")).toBe(false);
  });
});
