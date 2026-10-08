import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "./parseSlashCommand.js";

describe("parseSlashCommand queue commands", () => {
  it("parses bare /queue as queue inspection", () => {
    expect(parseSlashCommand("/queue")).toEqual({ kind: "queueShow" });
  });

  it("parses /queue clear before /queue <message>", () => {
    expect(parseSlashCommand("/queue clear")).toEqual({ kind: "queueClear" });
  });

  it("parses /queue <message> as an explicit queue-only message", () => {
    expect(parseSlashCommand("/queue run this after the current task")).toEqual({
      kind: "queueAdd",
      message: "run this after the current task",
    });
  });

  it("strips a leading agent mention before parsing /queue <message>", () => {
    expect(parseSlashCommand("@Xyne Doctor /queue follow up later")).toEqual({
      kind: "queueAdd",
      message: "follow up later",
    });
  });
});

describe("parseSlashCommand /debug", () => {
  it("parses /debug as an exact match", () => {
    expect(parseSlashCommand("/debug")).toEqual({ kind: "debug" });
  });

  it("strips a leading agent mention before /debug", () => {
    expect(parseSlashCommand("@Xyne Doctor /debug")).toEqual({ kind: "debug" });
  });

  it("parses /debug all (and the /debug sessions alias) as the multi-session scope", () => {
    expect(parseSlashCommand("/debug all")).toEqual({ kind: "debug", scope: "all" });
    expect(parseSlashCommand("/debug sessions")).toEqual({ kind: "debug", scope: "all" });
    expect(parseSlashCommand("@Xyne Doctor /debug all")).toEqual({ kind: "debug", scope: "all" });
    expect(parseSlashCommand("/DEBUG ALL")).toEqual({ kind: "debug", scope: "all" });
  });

  it("does not hijack prose or suffixed tokens", () => {
    expect(parseSlashCommand("/debugfoo")).toBeNull();
    expect(parseSlashCommand("/debug this for me")).toBeNull();
    expect(parseSlashCommand("can you check the /debug endpoint")).toBeNull();
  });
});

describe("parseSlashCommand mention placement and composer artifacts", () => {
  it("accepts an arg-less command written before the agent mention", () => {
    expect(parseSlashCommand("/debug chain @integration-planner")).toEqual({ kind: "debug", scope: "chain" });
    expect(parseSlashCommand("/debug chain @Integration Planner")).toEqual({ kind: "debug", scope: "chain" });
    expect(parseSlashCommand("/status @integration-planner")).toEqual({ kind: "status" });
    expect(parseSlashCommand("/help @integration-planner")).toEqual({ kind: "help" });
  });

  it("ignores zero-width characters around mention chips", () => {
    expect(parseSlashCommand("​@integration-planner /debug chain")).toEqual({ kind: "debug", scope: "chain" });
    expect(parseSlashCommand("@integration-planner​ /status﻿")).toEqual({ kind: "status" });
  });

  it("collapses repeated whitespace inside an arg-less command", () => {
    expect(parseSlashCommand("@integration-planner /debug  chain")).toEqual({ kind: "debug", scope: "chain" });
  });

  it("never rewrites arguments of arg-taking commands", () => {
    expect(parseSlashCommand("/goal fix the bug for @alice today")).toEqual({
      kind: "goalStart",
      condition: "fix the bug for @alice today",
    });
    expect(parseSlashCommand("/queue do x @bob")).toEqual({ kind: "queueAdd", message: "do x @bob" });
  });

  it("still rejects commands followed by prose", () => {
    expect(parseSlashCommand("@integration-planner /debug chain please")).toBeNull();
  });
});
