import { describe, expect, it } from "vitest";
import {
  COMMAND_REGISTRY,
  COMMAND_SECTION_ORDER,
  commandsForSurface,
  findCommand,
  taskPrefixCommandNames,
} from "@xyne/shared/commands";
import { IMMEDIATE_TASK_COMMAND_RE, LOOP_COMMANDS, TASK_COMMAND_NAMES } from "xyne-claw-shared";
import { parseSlashCommand } from "./parseSlashCommand.js";
import { buildHelpText } from "./webhook-commands/help.js";
import { CLAW_COMMANDS, findClawCommand } from "./command-help.js";

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
const { parseExperimentCommand } = await import("./experiment.js");

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

describe("every webhook command routes, is listed in /help, and has its own help", () => {
  const EXAMPLE_ARGS: Record<string, string> = { goal: "ship the release", eval: "what is 2+2" };
  for (const def of CLAW_COMMANDS) {
    const invocation = `/${def.name}${EXAMPLE_ARGS[def.name] ? ` ${EXAMPLE_ARGS[def.name]}` : ""}`;
    it(`/${def.name}`, () => {
      const routed =
        parseSlashCommand(invocation) !== null ||
        parseExperimentCommand(invocation) !== null ||
        (def.kind === "task-prefix" && IMMEDIATE_TASK_COMMAND_RE.test(invocation));
      expect(routed).toBe(true);
      expect(buildHelpText({ chat: false })).toContain(`\`/${def.name}`);
      expect(buildHelpText({ chat: false, command: def.name })).toContain(`/${def.name}`);
      expect(parseSlashCommand(`/help ${def.name}`)).toEqual({ kind: "help", command: def.name });
    });
  }

  it("lists every loop command and parses it into its own kind", () => {
    for (const loop of LOOP_COMMANDS) {
      expect(findClawCommand(loop.command)?.section).toBe("autonomy");
      const parsed = parseExperimentCommand(`${loop.command} 2h focus area`);
      expect(parsed).toMatchObject({ sub: "start", ...(loop.kind ? { kind: loop.kind } : {}) });
      if (!loop.kind) expect(parsed).not.toHaveProperty("kind");
    }
  });

  it("includes every webhook command from the shared registry, plus /eval", () => {
    const names = CLAW_COMMANDS.map((def) => def.name);
    for (const def of commandsForSurface("webhook")) expect(names).toContain(def.name);
    expect(names).toContain("eval");
    expect(new Set(names).size).toBe(names.length);
  });

  it("answers an unknown /help topic with the full list", () => {
    const text = buildHelpText({ chat: false, command: "nope" });
    expect(text).toContain("No command called `/nope`");
    expect(text).toContain("`/goal");
  });

  it("adds the chat-only commands in a messenger chat", () => {
    expect(buildHelpText({ chat: true })).toContain("`/agents`");
    expect(buildHelpText({ chat: false })).not.toContain("`/agents`");
  });
});
