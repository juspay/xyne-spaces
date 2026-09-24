import { describe, expect, it } from "vitest";
import { applyAiScreenCommand } from "./ai-screen-commands.js";

describe("applyAiScreenCommand", () => {
  it("passes a normal message through trimmed", () => {
    expect(applyAiScreenCommand("  hello world  ").task).toBe("hello world");
  });

  it("rewrites /compact to the compaction task", () => {
    const { task } = applyAiScreenCommand("/compact");
    expect(task.toLowerCase()).toContain("summary");
    expect(task).not.toMatch(/^\/compact/);
  });

  it("carries the focus from /compact <focus> into the task", () => {
    const { task } = applyAiScreenCommand("/compact keep the API decisions");
    expect(task).toContain("keep the API decisions");
  });

  it("does not treat a task-prefix command as compaction", () => {
    expect(applyAiScreenCommand("/design a landing page").task).toBe("/design a landing page");
  });
});
