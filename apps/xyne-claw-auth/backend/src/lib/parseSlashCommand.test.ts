import { describe, expect, it } from "vitest";

import { parseSlashCommand } from "./parseSlashCommand.js";

describe("parseSlashCommand — /goal options", () => {
  it("parses a bare /goal as a condition with no overrides", () => {
    const cmd = parseSlashCommand("/goal ship the release notes");
    expect(cmd).toEqual({ kind: "goalStart", condition: "ship the release notes" });
  });

  it("peels model= into a spaces-provider override (matches /experiment default)", () => {
    const cmd = parseSlashCommand("/goal model=open-large summarize the incident");
    expect(cmd).toMatchObject({
      kind: "goalStart",
      condition: "summarize the incident",
      providerOverride: { provider: "spaces", model: "open-large" },
    });
  });

  it("peels provider= against the allowlist", () => {
    const cmd = parseSlashCommand("/goal provider=claude do the thing");
    expect(cmd).toMatchObject({
      kind: "goalStart",
      condition: "do the thing",
      providerOverride: { provider: "claude" },
    });
  });

  it("keeps an unknown provider as goal text (never silently selects one)", () => {
    const cmd = parseSlashCommand("/goal provider=bogus keep going");
    expect(cmd).toMatchObject({ kind: "goalStart", condition: "provider=bogus keep going" });
    expect(cmd).not.toHaveProperty("providerOverride");
  });

  it("parses maxTurns= as a positive integer", () => {
    const cmd = parseSlashCommand("/goal maxTurns=10 keep iterating");
    expect(cmd).toMatchObject({ kind: "goalStart", condition: "keep iterating", maxTurns: 10 });
  });

  it("accepts max_turns and turns aliases", () => {
    expect(parseSlashCommand("/goal max_turns=7 x")).toMatchObject({ maxTurns: 7 });
    expect(parseSlashCommand("/goal turns=3 x")).toMatchObject({ maxTurns: 3 });
  });

  it("clamps maxTurns above the hard cap (20)", () => {
    const cmd = parseSlashCommand("/goal maxTurns=999 run forever please");
    expect(cmd).toMatchObject({ kind: "goalStart", condition: "run forever please", maxTurns: 20 });
  });

  it("treats invalid maxTurns as goal text rather than coercing it", () => {
    const cmd = parseSlashCommand("/goal maxTurns=abc keep going");
    expect(cmd).toMatchObject({ kind: "goalStart", condition: "maxTurns=abc keep going" });
    expect(cmd).not.toHaveProperty("maxTurns");
  });

  it("rejects zero / negative maxTurns (kept as text)", () => {
    expect(parseSlashCommand("/goal maxTurns=0 x")).toMatchObject({ condition: "maxTurns=0 x" });
    expect(parseSlashCommand("/goal maxTurns=-4 x")).toMatchObject({ condition: "maxTurns=-4 x" });
  });

  it("combines model= and maxTurns= in one command", () => {
    const cmd = parseSlashCommand("/goal model=open-large maxTurns=8 tidy the backlog");
    expect(cmd).toMatchObject({
      kind: "goalStart",
      condition: "tidy the backlog",
      providerOverride: { provider: "spaces", model: "open-large" },
      maxTurns: 8,
    });
  });

  it("leaves control commands untouched", () => {
    expect(parseSlashCommand("/goal status")).toEqual({ kind: "goalStatus" });
    expect(parseSlashCommand("/stop")).toEqual({ kind: "goalClear" });
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
  });
});
