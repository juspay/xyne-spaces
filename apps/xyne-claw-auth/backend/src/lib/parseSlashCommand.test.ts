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

  it("does not hijack prose or suffixed tokens", () => {
    expect(parseSlashCommand("/debugfoo")).toBeNull();
    expect(parseSlashCommand("/debug this for me")).toBeNull();
    expect(parseSlashCommand("can you check the /debug endpoint")).toBeNull();
  });
});
