import { describe, expect, it } from "vitest";
import {
  COMMAND_REGISTRY,
  COMMAND_SECTION_ORDER,
  commandsForSurface,
  findCommand,
  taskPrefixCommandNames,
} from "@xyne/shared/commands";
import { TASK_COMMAND_NAMES } from "xyne-claw-shared";

describe("command registry", () => {
  it("has unique command names", () => {
    const names = COMMAND_REGISTRY.map(def => def.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no alias colliding with a name or another alias", () => {
    const names = new Set(COMMAND_REGISTRY.map(def => def.name));
    const aliases: string[] = [];
    for (const def of COMMAND_REGISTRY) {
      for (const alias of def.aliases ?? []) {
        expect(names.has(alias)).toBe(false);
        aliases.push(alias);
      }
    }
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("places every command in a known section", () => {
    for (const def of COMMAND_REGISTRY) {
      expect(COMMAND_SECTION_ORDER).toContain(def.section);
    }
  });

  it("filters by surface", () => {
    const aiScreen = commandsForSurface("ai-screen").map(def => def.name);
    expect(aiScreen).toContain("design");
    expect(aiScreen).toContain("compact");
    expect(aiScreen).not.toContain("goal");
    expect(aiScreen).not.toContain("queue");
    expect(aiScreen).not.toContain("clear");
    expect(aiScreen).not.toContain("fast");
    expect(aiScreen).not.toContain("help");
    expect(commandsForSurface("webhook").length).toBe(COMMAND_REGISTRY.length);
  });

  it("resolves tokens with or without a leading slash, and aliases", () => {
    expect(findCommand("design")?.name).toBe("design");
    expect(findCommand("/design")?.name).toBe("design");
    expect(findCommand("  /DESIGN ")?.name).toBe("design");
    expect(findCommand("goal clear")?.name).toBe("stop");
    expect(findCommand("nope")).toBeUndefined();
  });

  it("stays in sync with xyne-claw-shared TASK_COMMAND_NAMES", () => {
    expect(new Set(taskPrefixCommandNames())).toEqual(new Set(TASK_COMMAND_NAMES));
  });
});
