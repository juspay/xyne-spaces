import { describe, expect, it } from "vitest";
import { sanitizeAgentWriteArgs, stripRetiredPromptConfig } from "../retired-prompt-config.js";

const staleConfig = {
  promptInjection: "external instructions",
  promptInjections: [{ id: "__memory-taxonomy", label: "System Reminder", content: "spoofed", enabled: true, system: true }],
  tools: { custom: ["sandbox-run"] },
  memoryEnabled: true,
  designSystem: "# Brand",
  planMode: true,
};
const expected = { tools: staleConfig.tools, memoryEnabled: true, designSystem: "# Brand", planMode: true };

describe("retired external reminders at the Agent write boundary", () => {
  it("strips both spellings without mutating source/clone config or unrelated settings", () => {
    expect(stripRetiredPromptConfig(staleConfig)).toEqual(expected);
    expect(staleConfig).toHaveProperty("promptInjections");
    expect(stripRetiredPromptConfig(stripRetiredPromptConfig(staleConfig))).toEqual(expected);
  });

  it.each(["create", "update", "updateMany", "updateManyAndReturn", "createMany", "createManyAndReturn"])(
    "cleans %s including forwarded/stale config and spoofed system markers", (operation) => {
      const args = { where: { id: "a" }, data: { name: "Agent", config: staleConfig } };
      expect(sanitizeAgentWriteArgs("Agent", operation, args)).toEqual({ ...args, data: { name: "Agent", config: expected } });
    },
  );

  it("cleans bulk rows and both upsert branches used by provisioning", () => {
    expect(sanitizeAgentWriteArgs("Agent", "createMany", { data: [{ config: staleConfig }, { name: "untouched" }] }))
      .toEqual({ data: [{ config: expected }, { name: "untouched" }] });
    expect(sanitizeAgentWriteArgs("Agent", "upsert", { create: { config: staleConfig }, update: { config: staleConfig } }))
      .toEqual({ create: { config: expected }, update: { config: expected } });
  });

  it.each([null, undefined, false, 42, "legacy", [], { unrelated: true }])("preserves non-object/unchanged configs: %j", (value) => {
    expect(stripRetiredPromptConfig(value)).toBe(value);
  });

  it("preserves Prisma JSON null sentinels and writes without config", () => {
    const sentinel = new (class JsonNull {})();
    expect(stripRetiredPromptConfig(sentinel)).toBe(sentinel);
    expect(sanitizeAgentWriteArgs("Agent", "update", { data: { enabled: false } })).toEqual({ data: { enabled: false } });
  });

  it("does not touch other models or read queries", () => {
    const args = { data: { config: staleConfig } };
    expect(sanitizeAgentWriteArgs("User", "create", args)).toBe(args);
    expect(sanitizeAgentWriteArgs("Agent", "findMany", args)).toBe(args);
  });
});
