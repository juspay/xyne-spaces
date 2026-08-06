import { describe, expect, it } from "vitest";
import { loadCustomTools } from "../src/custom-tools.js";
import { parseTaskCommand } from "../src/task-commands.js";

describe("/explainer task command", () => {
  it("matches only the leading command token", () => {
    expect(parseTaskCommand("/explainer explain Redis")?.command).toBe("/explainer");
    expect(parseTaskCommand("  /EXPLAINER\nexplain Redis")?.command).toBe("/explainer");
    expect(parseTaskCommand("please /explainer Redis")).toBeNull();
    expect(parseTaskCommand("/explainers Redis")).toBeNull();
  });

  it("declares the complete command-owned tool palette", () => {
    expect(parseTaskCommand("/explainer Redis")?.autoTools).toEqual([
      "sandbox-create",
      "create-video-explainer",
    ]);
  });

  it("force-loads command tools without changing the saved agent config", () => {
    const savedConfig = { tools: { custom: ["todo-read"] } };
    const command = parseTaskCommand("/explainer Redis");
    const loaded = loadCustomTools(
      savedConfig,
      { userId: "u1", conversationId: "c1", agentSlug: "a1", taskCommand: "/explainer" },
      undefined,
      undefined,
      undefined,
      "session-1",
      "s2s-key",
      "session-token",
      undefined,
      undefined,
      undefined,
      command?.autoTools,
    );

    const names = loaded.tools.map((tool) => tool.name);
    expect(names).toContain("sandbox-create");
    expect(names).toContain("create-video-explainer");
    expect(savedConfig).toEqual({ tools: { custom: ["todo-read"] } });
  });
});
