import { describe, expect, it } from "vitest";

import {
  RESERVED_COMMAND_SLUGS,
  renderCommandTemplate,
  renderCommandToGoalStart,
  validateCommandSlug,
} from "./commandRegistry.js";
import { extractCustomCommandInvocation, parseSlashCommand } from "./parseSlashCommand.js";

describe("validateCommandSlug", () => {
  it("accepts a normal slug and lowercases it", () => {
    expect(validateCommandSlug("Triage")).toEqual({ ok: true, slug: "triage" });
  });

  it("rejects a reserved built-in verb", () => {
    const res = validateCommandSlug("goal");
    expect(res.ok).toBe(false);
  });

  it("rejects an over-short or malformed slug", () => {
    expect(validateCommandSlug("x").ok).toBe(false);
    expect(validateCommandSlug("1abc").ok).toBe(false);
    expect(validateCommandSlug("has space").ok).toBe(false);
  });

  it("every reserved slug is itself rejected", () => {
    for (const slug of RESERVED_COMMAND_SLUGS) {
      expect(validateCommandSlug(slug).ok).toBe(false);
    }
  });
});

describe("renderCommandTemplate", () => {
  it("substitutes {input}", () => {
    expect(renderCommandTemplate("investigate {input} and report", "the 500s")).toBe(
      "investigate the 500s and report",
    );
  });

  it("replaces every {input} occurrence", () => {
    expect(renderCommandTemplate("{input} — repeat: {input}", "x")).toBe("x — repeat: x");
  });

  it("appends input as a paragraph when there is no placeholder", () => {
    expect(renderCommandTemplate("summarize the incident", "focus on auth")).toBe(
      "summarize the incident\n\nfocus on auth",
    );
  });

  it("leaves a placeholder-less template untouched when input is empty", () => {
    expect(renderCommandTemplate("do the standing task", "")).toBe("do the standing task");
  });
});

describe("renderCommandToGoalStart", () => {
  it("maps a template + budgets + provider into a goalStart", () => {
    const cmd = renderCommandToGoalStart(
      {
        slug: "triage",
        template: "investigate {input} and post an RCA",
        provider: "claude",
        maxTurns: 8,
        maxWallClockMs: 3_600_000,
      },
      "the webhook is 500ing",
    );
    expect(cmd).toEqual({
      kind: "goalStart",
      condition: "investigate the webhook is 500ing and post an RCA",
      providerOverride: { provider: "claude" },
      maxTurns: 8,
      maxWallClockMs: 3_600_000,
    });
  });

  it("promotes a bare model to a spaces-provider override (matches /goal)", () => {
    const cmd = renderCommandToGoalStart(
      { slug: "sum", template: "summarize {input}", model: "open-large" },
      "the thread",
    );
    expect(cmd).toMatchObject({
      kind: "goalStart",
      condition: "summarize the thread",
      providerOverride: { provider: "spaces", model: "open-large" },
    });
  });

  it("omits provider/budgets when the definition has none", () => {
    const cmd = renderCommandToGoalStart({ slug: "x", template: "do {input}" }, "it");
    expect(cmd).toEqual({ kind: "goalStart", condition: "do it" });
  });
});

describe("parseSlashCommand — /command management", () => {
  it("parses /command list (and the bare/plural forms)", () => {
    expect(parseSlashCommand("/command list")).toEqual({ kind: "commandList" });
    expect(parseSlashCommand("/command")).toEqual({ kind: "commandList" });
    expect(parseSlashCommand("/commands")).toEqual({ kind: "commandList" });
  });

  it("parses /command show and /command delete", () => {
    expect(parseSlashCommand("/command show triage")).toEqual({ kind: "commandShow", slug: "triage" });
    expect(parseSlashCommand("/command delete triage")).toEqual({ kind: "commandDelete", slug: "triage" });
    expect(parseSlashCommand("/command rm triage")).toEqual({ kind: "commandDelete", slug: "triage" });
  });

  it("parses /command define with leading options then a template", () => {
    const cmd = parseSlashCommand("/command define triage maxTurns=8 maxTime=1h model=open-large investigate {input}");
    expect(cmd).toEqual({
      kind: "commandDefine",
      slug: "triage",
      template: "investigate {input}",
      providerOverride: { provider: "spaces", model: "open-large" },
      maxTurns: 8,
      maxWallClockMs: 3_600_000,
    });
  });

  it("clamps define budgets to the /goal hard caps", () => {
    const cmd = parseSlashCommand("/command define big maxTurns=999 maxTime=99h keep going {input}");
    expect(cmd).toMatchObject({
      kind: "commandDefine",
      maxTurns: 20,
      maxWallClockMs: 6 * 60 * 60 * 1000,
    });
  });

  it("treats a malformed option as the start of the template (never silently coerced)", () => {
    const cmd = parseSlashCommand("/command define t maxTurns=abc do the thing");
    expect(cmd).toEqual({
      kind: "commandDefine",
      slug: "t",
      template: "maxTurns=abc do the thing",
    });
  });

  it("returns null for a define with no template", () => {
    expect(parseSlashCommand("/command define onlyslug")).toBeNull();
  });
});

describe("extractCustomCommandInvocation", () => {
  it("extracts a custom slug and its input", () => {
    expect(extractCustomCommandInvocation("/triage the payment webhook is 500ing")).toEqual({
      slug: "triage",
      input: "the payment webhook is 500ing",
    });
  });

  it("extracts a bare custom slug with empty input", () => {
    expect(extractCustomCommandInvocation("/triage")).toEqual({ slug: "triage", input: "" });
  });

  it("strips leading @mentions before the slug", () => {
    expect(extractCustomCommandInvocation("@Xyne Doctor /triage look at logs")).toEqual({
      slug: "triage",
      input: "look at logs",
    });
  });

  it("returns null for built-in verbs (never resolved against the registry)", () => {
    expect(extractCustomCommandInvocation("/goal do a thing")).toBeNull();
    expect(extractCustomCommandInvocation("/stop")).toBeNull();
    expect(extractCustomCommandInvocation("/help")).toBeNull();
  });

  it("returns null for prose that merely contains a slash", () => {
    expect(extractCustomCommandInvocation("please check the /api/foo route")).toBeNull();
    expect(extractCustomCommandInvocation("run it and/or skip")).toBeNull();
  });
});
