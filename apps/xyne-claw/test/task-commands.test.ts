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

describe("/review", () => {
  it("parses and loads the review skill pack", () => {
    const command = parseTaskCommand("/review the local changes");
    expect(command?.command).toBe("/review");
    expect(command?.skillPaths).toContain("review-skills");
  });

  it("contracts for a delivered review room with diagrams", () => {
    const command = parseTaskCommand("/review");
    expect(command?.instruction).toContain("review-room.html");
    expect(command?.instruction).toContain("mermaid");
    expect(command?.nudge).toContain("review-room.html");
  });

  it("contracts for machine-readable comments the diff viewer can anchor", () => {
    const command = parseTaskCommand("/review");
    expect(command?.instruction).toContain("review-comments.json");
    expect(command?.instruction).toContain("NEW-side line number");
    expect(command?.instruction).toContain("order");
    expect(command?.nudge).toContain("review-comments.json");
  });

  it("forces no tools and pins no sandbox profile, so it can run anywhere", () => {
    const command = parseTaskCommand("/review");
    expect(command?.autoTools).toEqual([]);
    expect(command?.sandboxProfile).toBeUndefined();
    expect(command?.requiredTool).toBeUndefined();
  });

  it("never edits the tree on its own", () => {
    const command = parseTaskCommand("/review");
    expect(command?.instruction).toContain("Do not edit, commit, or push");
  });
});

describe("/learn", () => {
  it("parses and loads the teaching skill pack", () => {
    const command = parseTaskCommand("/learn how SSRF works from these links");
    expect(command?.command).toBe("/learn");
    expect(command?.skillPaths).toContain("learn-skills");
  });

  it("forces the browser tool so sources open where the user can watch", () => {
    expect(parseTaskCommand("/learn")?.autoTools).toContain("open-url");
  });

  it("refuses to teach from a page it could not open", () => {
    const instruction = parseTaskCommand("/learn")?.instruction ?? "";
    expect(instruction).toContain("Never teach from a page");
    expect(instruction).toContain("never backfill from memory");
  });

  it("contracts for a delivered lesson and forbids the chat fence", () => {
    const command = parseTaskCommand("/learn");
    expect(command?.instruction).toContain("lesson.html");
    expect(command?.instruction).toContain("fenced html block");
    expect(command?.nudge).toContain("lesson.html");
  });
});

describe("/brand task command", () => {
  it("parses only as a leading token, like the other task commands", () => {
    expect(parseTaskCommand("/brand https://stripe.com")?.command).toBe("/brand");
    expect(parseTaskCommand("  /BRAND\nuse the attached screenshot")?.command).toBe("/brand");
    expect(parseTaskCommand("please /brand this site")).toBeNull();
    expect(parseTaskCommand("/branding guidelines")).toBeNull();
  });

  it("runs immediately rather than waiting for plan approval", () => {
    expect(resolveTaskCommandMode("/brand https://stripe.com", "plan")).toBe("auto");
  });

  it("claims the browser sandbox and the Playwright tools extraction needs", () => {
    const command = parseTaskCommand("/brand https://stripe.com");
    expect(command?.sandboxProfile).toBe("browser");
    expect(command?.requiredTool).toBe("sandbox-deliver-files");
    // brand-skills is /brand's own folder. The extraction skills must NOT sit
    // in design-skills, which /design and /dashboard load wholesale — those
    // runs would be told "measure, never improve" and "deliver brand.json".
    expect(command?.skillPaths).toEqual(["brand-skills", "design-skills"]);
    // Computed styles are read through evaluate; screenshots and navigation
    // are what makes this a browser run rather than a fetch.
    for (const tool of ["sandbox-pw-navigate", "sandbox-pw-evaluate", "sandbox-pw-screenshot"]) {
      expect(command?.autoTools).toContain(tool);
    }
  });

  it("does NOT inject an existing design system into the run", () => {
    // /brand PRODUCES a system. Injecting the agent's current one would let it
    // leak into the extraction and describe the old brand as the new one.
    const command = parseTaskCommand("/brand https://stripe.com");
    const injection = buildDesignSystemPromptInjection(command, {
      designSystem: "# Previous brand\nPrimary is red.",
    });
    expect(injection.status).toBe("absent");
  });

  it("still injects for /design, so the gate was narrowed and not broken", () => {
    const injection = buildDesignSystemPromptInjection(parseTaskCommand("/design a page"), {
      designSystem: "# Brand",
    });
    expect(injection.status).toBe("injected");
  });
});

describe("design-voice-check reads the rules the model was given", () => {
  const BRAND = [
    "# Acme",
    "",
    "## Voice",
    "- Banned phrases: synergy",
    "",
    "## Colour",
    "- Primary: #123456",
  ].join("\n");

  const voiceCheck = async (
    agentConfig: Record<string, unknown>,
    meta: Record<string, string>,
  ): Promise<string> => {
    const loaded = loadCustomTools(
      agentConfig,
      meta,
      undefined,
      undefined,
      undefined,
      "session-1",
      "s2s-key",
      "session-token",
      undefined,
      undefined,
      undefined,
      ["design-voice-check"],
    );
    const tool = loaded.tools.find((t) => t.name === "design-voice-check");
    if (!tool) throw new Error("design-voice-check was not loaded");
    const result = await tool.execute("call-1", {
      content: "<h1>Unlock synergy today</h1>",
    });
    const first = result.content[0];
    return first && "text" in first ? first.text : "";
  };

  it("checks against the system a /design run was given", async () => {
    const report = await voiceCheck(
      { designSystem: BRAND },
      { userId: "u1", agentSlug: "a", taskCommand: "/design" },
    );
    expect(report).toContain("synergy");
  });

  it("checks nothing when the system was too large to inject", async () => {
    // The injection drops a system over the cap, so the model designs without
    // it. Reading agentConfig directly held the artifact to rules it was never
    // shown, and the run log was the only place that disagreement appeared.
    const report = await voiceCheck(
      { designSystem: `${BRAND}\n${"<!-- pad -->".repeat(DESIGN_SYSTEM_MAX_CHARS)}` },
      { userId: "u1", agentSlug: "a", taskCommand: "/design" },
    );
    expect(report).toContain("no voice rules");
    expect(report).not.toContain("synergy");
  });

  it("checks nothing on a /brand run, which is never given a system", async () => {
    // /brand EXTRACTS a system; injecting the agent's current one would let the
    // old brand describe the new one. The voice pin has to honour that gate too.
    const report = await voiceCheck(
      { designSystem: BRAND },
      { userId: "u1", agentSlug: "a", taskCommand: "/brand" },
    );
    expect(report).toContain("no voice rules");
  });

  it("checks nothing on an ordinary run with no command", async () => {
    const report = await voiceCheck({ designSystem: BRAND }, { userId: "u1", agentSlug: "a" });
    expect(report).toContain("no voice rules");
  });

  it("still honours an explicit designMd, which is how a run checks another system", async () => {
    const loaded = loadCustomTools(
      {},
      { userId: "u1", agentSlug: "a" },
      undefined,
      undefined,
      undefined,
      "session-1",
      "s2s-key",
      "session-token",
      undefined,
      undefined,
      undefined,
      ["design-voice-check"],
    );
    const tool = loaded.tools.find((t) => t.name === "design-voice-check");
    if (!tool) throw new Error("design-voice-check was not loaded");
    const result = await tool.execute("call-1", {
      content: "<h1>Unlock synergy today</h1>",
      designMd: BRAND,
    });
    const first = result.content[0];
    expect(first && "text" in first ? first.text : "").toContain("synergy");
  });
});

describe("skill isolation between /brand and /design", () => {
  it("keeps the brand skills out of /design and /dashboard", () => {
    // Both load design-skills wholesale, so a brand skill living there told a
    // design run to "measure, never improve" and "deliver brand.json".
    for (const task of ["/design a page", "/dashboard revenue"]) {
      expect(parseTaskCommand(task)?.skillPaths).toEqual(["design-skills"]);
    }
  });

  it("gives /brand its own folder first, then the shared design guidance", () => {
    expect(parseTaskCommand("/brand https://x.com")?.skillPaths).toEqual([
      "brand-skills",
      "design-skills",
    ]);
  });
});
