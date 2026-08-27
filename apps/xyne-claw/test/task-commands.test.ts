import { describe, expect, it } from "vitest";
import { loadCustomTools } from "../src/custom-tools.js";
import {
  DESIGN_SYSTEM_MAX_CHARS,
  SPEC_QUESTION_OUTLINE,
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

  it("injects the same design system contract for /dashboard runs", () => {
    const result = buildDesignSystemPromptInjection(parseTaskCommand("/dashboard reliability"), {
      designSystem: "# Operations brand",
    });
    expect(result.status).toBe("injected");
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

describe("/dashboard task command", () => {
  it("matches only the leading command token and runs immediately", () => {
    expect(parseTaskCommand("/dashboard error rates")?.command).toBe("/dashboard");
    expect(parseTaskCommand("  /DASHBOARD\nlatency by service")?.command).toBe("/dashboard");
    expect(parseTaskCommand("please /dashboard latency")).toBeNull();
    expect(parseTaskCommand("/dashboards latency")).toBeNull();
    expect(resolveTaskCommandMode("/dashboard latency", "plan")).toBe("auto");
  });

  it("mounts the browser artifact workflow and real-data contract", () => {
    const command = parseTaskCommand("/dashboard latency");
    expect(command?.requiredTool).toBe("sandbox-deliver-files");
    expect(command?.sandboxProfile).toBe("browser");
    expect(command?.skillPaths).toEqual(["design-skills"]);
    expect(command?.autoTools).toContain("sandbox-pw-screenshot");
    expect(command?.autoTools).toContain("schedule-task");
    expect(command?.instruction).toContain("Never invent");
    expect(command?.instruction).toContain("Data as of");
    expect(command?.instruction).toContain("Keep runtime credentials");
    expect(command?.nudge).toContain("stop without delivering a fake dashboard");

    const loaded = loadCustomTools(
      { tools: { custom: [] } },
      { userId: "u1", conversationId: "c1", agentSlug: "a1", taskCommand: "/dashboard" },
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
    expect(names).toContain("sandbox-deliver-files");
    expect(names).toContain("schedule-task");
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

describe("/spec task command", () => {
  it("matches only the leading command token", () => {
    expect(parseTaskCommand("/spec write the spec for XYNE-1")?.command).toBe("/spec");
    expect(parseTaskCommand("  /SPEC\nXYNE-1")?.command).toBe("/spec");
    expect(parseTaskCommand("please /spec XYNE-1")).toBeNull();
    expect(parseTaskCommand("/specs XYNE-1")).toBeNull();
  });

  it("binds the run with a command-owned skill and delivery contract", () => {
    const command = parseTaskCommand("/spec XYNE-1");
    expect(command?.requiredTool).toBeUndefined();
    expect(command?.skillPaths).toEqual(["spec-skills"]);
    expect(command?.instruction).toContain("Ticket Specs skill");
    const outputFormat = command?.agentConfigOverlay?.["outputFormat"] as
      | { type?: string; template?: string }
      | undefined;
    expect(outputFormat?.type).toBe("markdown");
    expect(outputFormat?.template).toBe(SPEC_QUESTION_OUTLINE);
  });

  it("keeps the first turn as a context-first interview", () => {
    for (const heading of [
      "Problem statement",
      "Solutioning",
      "Test cases",
      "Implementation details",
      "Out of scope",
    ]) {
      expect(SPEC_QUESTION_OUTLINE).toContain(heading);
    }
    expect(SPEC_QUESTION_OUTLINE).toContain("summarize the ticket/context");
    expect(SPEC_QUESTION_OUTLINE).toContain("existing description/Specification state");
    expect(SPEC_QUESTION_OUTLINE).toContain("contextual clarification questions");
    expect(SPEC_QUESTION_OUTLINE).toContain("Do NOT mechanically ask");
  });

  it("allows technical context but prevents implementation-derived specs and same-turn writes", () => {
    expect(SPEC_QUESTION_OUTLINE).toContain("technical context or code/PR context");
    expect(SPEC_QUESTION_OUTLINE).toContain("Do NOT derive requirement intent solely from implementation");
    expect(SPEC_QUESTION_OUTLINE).toContain("Ask the minimum useful batch of questions");
    expect(SPEC_QUESTION_OUTLINE).toContain("Do NOT create, draft, or update the Specification");
  });

  it("keeps the overlay off the agent's own config", () => {
    const savedConfig: Record<string, unknown> = { tools: { custom: ["todo-read"] } };
    const command = parseTaskCommand("/spec XYNE-1");
    const merged = { ...savedConfig, ...(command?.agentConfigOverlay ?? {}) };

    expect(merged["outputFormat"]).toBeDefined();
    expect(savedConfig["outputFormat"]).toBeUndefined();
  });

  it("executes immediately instead of entering plan mode", () => {
    expect(resolveTaskCommandMode("/spec XYNE-1", "plan")).toBe("auto");
  });
});
