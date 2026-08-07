import { describe, expect, it } from "vitest";
import { loadCustomTools } from "../src/custom-tools.js";
import {
  DESIGN_SYSTEM_MAX_CHARS,
  buildDesignSystemPromptInjection,
  parseTaskCommand,
  resolveTaskCommandMode,
} from "../src/task-commands.js";

describe("/design task command", () => {
  it("matches only the leading command token and runs immediately", () => {
    expect(parseTaskCommand("/design build a billing page")?.command).toBe("/design");
    expect(parseTaskCommand("  /DESIGN\nrevise the card")?.command).toBe("/design");
    expect(parseTaskCommand("please /design a page")).toBeNull();
    expect(parseTaskCommand("/designer page")).toBeNull();
    expect(resolveTaskCommandMode("/design page", "plan")).toBe("auto");
  });

  it("loads the Xyne design pack and command-owned creation/inspection tools", () => {
    const command = parseTaskCommand("/design page");
    expect(command?.skillPaths).toEqual(["design-skills"]);
    expect(command?.requiredTool).toBe("sandbox-deliver-files");

    const loaded = loadCustomTools(
      { tools: { custom: [] } },
      { userId: "u1", conversationId: "c1", agentSlug: "ordinary-agent", taskCommand: "/design" },
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
    expect(names).toContain("sandbox-write-file");
    expect(names).toContain("sandbox-pw-screenshot");
    expect(names).toContain("generate-image");
    expect(names).toContain("sandbox-deliver-files");
  });

  it("exports React designs as portable HTML plus an editable source project", () => {
    const command = parseTaskCommand("/design build an interactive React dashboard");
    expect(command?.instruction).toContain("source archive");
    expect(command?.nudge).toContain("HTML plus React source archive");
    expect(command?.nudge).toContain("do not repeat the large bundle in chat");
  });

  it("injects a design system contract for /design runs", () => {
    const command = parseTaskCommand("/design page");
    const result = buildDesignSystemPromptInjection(command, {
      designSystem: "\n# Brand\nUse #123456 for primary actions.\n",
    });
    expect(result.status).toBe("injected");
    if (result.status !== "injected") throw new Error("expected design system injection");
    expect(result.injection.id).toBe("__design-system-brand-contract");
    expect(result.injection.label).toBe("## Design System — binding brand contract");
    expect(result.injection.content).toContain("MUST comply");
    expect(result.injection.content).toContain("# Brand\nUse #123456");
  });

  it("skips the design system contract when absent or empty", () => {
    const command = parseTaskCommand("/design page");
    expect(buildDesignSystemPromptInjection(command, {}).status).toBe("absent");
    expect(buildDesignSystemPromptInjection(command, { designSystem: "   \n" }).status).toBe("absent");
    expect(
      buildDesignSystemPromptInjection(parseTaskCommand("/explainer Redis"), {
        designSystem: "# Brand",
      }).status,
    ).toBe("absent");
  });

  it("skips oversized design system contracts", () => {
    const command = parseTaskCommand("/design page");
    const result = buildDesignSystemPromptInjection(command, {
      designSystem: "x".repeat(DESIGN_SYSTEM_MAX_CHARS + 1),
    });
    expect(result.status).toBe("oversized");
    if (result.status !== "oversized") throw new Error("expected oversized result");
    expect(result.length).toBe(DESIGN_SYSTEM_MAX_CHARS + 1);
  });
});

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
