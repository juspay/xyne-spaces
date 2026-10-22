import { describe, expect, it } from "vitest";
import { LOOP_COMMANDS, LOOP_KINDS, loopCommandFor, loopCommandForWord, loopModeLog, parseLoopKind, withLoopKind } from "./loop-commands.js";

describe("loop command registry", () => {
  it("has one command per kind plus /experiment, with unique keys and command words", () => {
    expect(LOOP_COMMANDS.map((def) => def.kind).filter(Boolean).sort()).toEqual([...LOOP_KINDS].sort());
    expect(new Set(LOOP_COMMANDS.map((def) => def.key)).size).toBe(LOOP_COMMANDS.length);
    expect(new Set(LOOP_COMMANDS.map((def) => def.command)).size).toBe(LOOP_COMMANDS.length);
  });

  it("falls back to /experiment for a missing or unknown kind", () => {
    expect(loopCommandFor(undefined).key).toBe("experiment");
    expect(loopCommandFor("bogus").key).toBe("experiment");
    expect(loopCommandFor("security").command).toBe("/security-scan");
  });

  it("only carries a known kind onto a payload", () => {
    expect(parseLoopKind("framework")).toBe("framework");
    expect(parseLoopKind("nope")).toBeUndefined();
    expect(withLoopKind("repo-history")).toEqual({ kind: "repo-history" });
    expect(withLoopKind(null)).toEqual({});
  });

  it("matches a command word at the start of the message", () => {
    expect(loopCommandForWord("/security-scan 30m api")?.kind).toBe("security");
    expect(loopCommandForWord("/experiment 1h")?.kind).toBeNull();
    expect(loopCommandForWord("please /experiment")).toBeUndefined();
  });

  it("keeps the exit, deliverable and close rules consistent", () => {
    for (const def of LOOP_COMMANDS) {
      if (def.exit === "frontier") expect(def.deliverable).not.toBeNull();
      if (!def.deadlineReleases) expect(def.graph).toBe("progress");
    }
  });

  it("renders the mode log line", () => {
    expect(loopModeLog(loopCommandFor(undefined), { epoch: 3, remaining: "42m" })).toBe(
      "Experiment mode — injected experiment tools (epoch 3, remaining 42m)",
    );
    expect(loopModeLog(loopCommandFor("repo-history"), { epoch: 7, remaining: "x" })).toBe(
      "Repo-history mode — injected experiment tools (epoch 7, progress-gated exit at HEAD)",
    );
  });
});
