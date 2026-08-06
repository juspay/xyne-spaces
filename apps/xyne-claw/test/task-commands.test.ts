import { describe, expect, it } from "vitest";
import { loadCustomTools } from "../src/custom-tools.js";
import { parseTaskCommand, resolveTaskCommandMode } from "../src/task-commands.js";

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

  it("runs command contracts immediately instead of entering generic plan mode", () => {
    expect(resolveTaskCommandMode("/explainer Redis", "plan")).toBe("auto");
    expect(resolveTaskCommandMode("Explain Redis", "plan")).toBe("plan");
    expect(resolveTaskCommandMode("/explainer Redis", undefined)).toBe("auto");
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

describe("/record-skill task command", () => {
  it("matches only the leading command token", () => {
    expect(parseTaskCommand("/record-skill make this reusable")?.command).toBe("/record-skill");
    expect(parseTaskCommand("  /RECORD-SKILL\nname it deploy-check")?.command).toBe("/record-skill");
    expect(parseTaskCommand("please /record-skill this")).toBeNull();
    expect(parseTaskCommand("/record-skills this")).toBeNull();
  });

  it("force-mounts the sandbox analyzer and approval-gated skill writer", () => {
    const command = parseTaskCommand("/record-skill");
    expect(command?.autoTools).toEqual([
      "sandbox-create",
      "analyze-skill-recording",
      "create-skill",
    ]);

    const loaded = loadCustomTools(
      { tools: { custom: [] } },
      { userId: "u1", conversationId: "c1", agentSlug: "a1", taskCommand: "/record-skill" },
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
    expect(names).toContain("analyze-skill-recording");
    expect(names).toContain("create-skill");
  });

  it("executes immediately instead of entering plan mode", () => {
    expect(resolveTaskCommandMode("/record-skill", "plan")).toBe("auto");
  });
});
