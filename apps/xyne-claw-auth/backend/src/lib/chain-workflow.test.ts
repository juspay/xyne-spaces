import { describe, it, expect } from "vitest";
import {
  parseChainWorkflowDefinition,
  validateChainWorkflowDefinition,
  resolveChainEdgeMode,
  evaluateChainToolConditions,
  evaluateChainCommandConditions,
  summarizeChainToolInvocations,
  resolveChainResultText,
  chainCommandPatternMatches,
  CHAIN_COMMAND_PATTERN_MAX_LENGTH,
  type ChainWorkflowDefinition,
} from "./chain-workflow.js";

const inv = (toolName: string, args: unknown, isError = false) => ({
  toolName,
  args,
  result: "",
  isError,
  startedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 1,
});

const commit = inv("sandbox-run", { cmd: "git commit -m 'fix: thing'" });
const listing = inv("sandbox-run", { cmd: "ls -la src" });
const search = inv("spaces-search", { query: "incident" });

function definition(edge: Record<string, unknown>): ChainWorkflowDefinition {
  const parsed = parseChainWorkflowDefinition({
    version: 1,
    nodes: [
      { id: "a", agentSlug: "alpha" },
      { id: "b", agentSlug: "beta" },
    ],
    edges: [{ id: "e1", fromNodeId: "a", toNodeId: "b", ...edge }],
  });
  if (!parsed) throw new Error("parse failed");
  return parsed;
}

describe("tools mode", () => {
  it("requires every include entry", () => {
    expect(evaluateChainToolConditions({ toolsMustInclude: ["a", "b"] }, ["a", "b"])).toBe(true);
    expect(evaluateChainToolConditions({ toolsMustInclude: ["a", "b"] }, ["a"])).toBe(false);
  });

  it("rejects when any exclude entry is present", () => {
    expect(evaluateChainToolConditions({ toolsMustExclude: ["x"] }, ["a"])).toBe(true);
    expect(evaluateChainToolConditions({ toolsMustExclude: ["x"] }, ["a", "x"])).toBe(false);
  });

  it("combines include and exclude", () => {
    expect(
      evaluateChainToolConditions({ toolsMustInclude: ["a"], toolsMustExclude: ["x"] }, ["a", "x"]),
    ).toBe(false);
    expect(
      evaluateChainToolConditions({ toolsMustInclude: ["a"], toolsMustExclude: ["x"] }, ["a"]),
    ).toBe(true);
  });

  it("passes with no conditions", () => {
    expect(evaluateChainToolConditions(undefined, [])).toBe(true);
  });
});

describe("commands mode", () => {
  it("matches a substring case-insensitively against the command args", () => {
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["GIT COMMIT"] }, [commit])).toBe(true);
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["git commit"] }, [listing])).toBe(false);
  });

  it("does not fire on a normal flow with no matching command", () => {
    expect(
      evaluateChainCommandConditions({ commandsMustMatch: ["git commit"] }, [listing, search]),
    ).toBe(false);
  });

  it("supports slash-delimited regex entries", () => {
    expect(
      evaluateChainCommandConditions({ commandsMustMatch: ["/^sandbox-run git (add|commit)\\b/"] }, [commit]),
    ).toBe(true);
    expect(
      evaluateChainCommandConditions({ commandsMustMatch: ["/git (add|commit)\\b/"] }, [commit]),
    ).toBe(true);
    expect(
      evaluateChainCommandConditions({ commandsMustMatch: ["/git (add|commit)\\b/"] }, [listing]),
    ).toBe(false);
  });

  it("requires every must-match entry to be hit by some invocation", () => {
    expect(
      evaluateChainCommandConditions({ commandsMustMatch: ["git commit", "ls -la"] }, [commit, listing]),
    ).toBe(true);
    expect(
      evaluateChainCommandConditions({ commandsMustMatch: ["git commit", "npm test"] }, [commit, listing]),
    ).toBe(false);
  });

  it("rejects when any must-not-match entry is hit", () => {
    expect(
      evaluateChainCommandConditions(
        { commandsMustMatch: ["git commit"], commandsMustNotMatch: ["git push"] },
        [commit],
      ),
    ).toBe(true);
    expect(
      evaluateChainCommandConditions(
        { commandsMustMatch: ["git commit"], commandsMustNotMatch: ["git push"] },
        [commit, inv("sandbox-run", { cmd: "git push origin main" })],
      ),
    ).toBe(false);
  });

  it("falls back to serialized args for tools without cmd/command", () => {
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["incident"] }, [search])).toBe(true);
  });

  it("matches against the tool name too", () => {
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["spaces-search"] }, [search])).toBe(true);
  });

  it("treats a bad regex as invalid without throwing", () => {
    expect(chainCommandPatternMatches("/(unclosed/", "git commit")).toBe("invalid");
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["/(unclosed/"] }, [commit])).toBe(false);
  });

  it("fails closed when a mustNotMatch pattern is invalid", () => {
    expect(evaluateChainCommandConditions({ commandsMustNotMatch: ["/(unclosed/"] }, [commit])).toBe(false);
    expect(evaluateChainCommandConditions({ commandsMustNotMatch: ["/(unclosed/"] }, [])).toBe(false);
  });

  it("rejects nested-quantifier regexes as invalid", () => {
    expect(chainCommandPatternMatches("/(a+)+$/", "aaaa")).toBe("invalid");
    expect(chainCommandPatternMatches("/(npm|pnpm|yarn|bun) (run )?test|vitest/", "sandbox-run npm test")).toBe("match");
  });

  it("refuses over-long patterns", () => {
    expect(chainCommandPatternMatches("a".repeat(CHAIN_COMMAND_PATTERN_MAX_LENGTH + 1), "aaaa")).toBe("invalid");
  });

  it("passes with no invocations only when nothing must match", () => {
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["git commit"] }, undefined)).toBe(false);
    expect(evaluateChainCommandConditions({ commandsMustNotMatch: ["git push"] }, undefined)).toBe(true);
  });
});

describe("mode resolution and parsing", () => {
  it("keeps commands mode and its lists", () => {
    const parsed = definition({ mode: "commands", commandsMustMatch: ["git commit"] });
    expect(parsed.edges[0]?.mode).toBe("commands");
    expect(parsed.edges[0]?.commandsMustMatch).toEqual(["git commit"]);
  });

  it("drops unknown modes", () => {
    const parsed = definition({ mode: "vibes" });
    expect(parsed.edges[0]?.mode).toBeUndefined();
    expect(resolveChainEdgeMode(parsed.edges[0]!)).toBe("always");
  });

  it("infers commands mode from the lists alone", () => {
    const parsed = definition({ commandsMustMatch: ["git commit"] });
    expect(resolveChainEdgeMode(parsed.edges[0]!)).toBe("commands");
  });

  it("infers tools mode from the tool lists alone", () => {
    const parsed = definition({ toolsMustInclude: ["spaces-search"] });
    expect(resolveChainEdgeMode(parsed.edges[0]!)).toBe("tools");
  });
});

describe("save-time validation", () => {
  it("rejects a judge edge with no judgeContext", () => {
    const err = validateChainWorkflowDefinition(definition({ mode: "judge" }));
    expect(err).toMatch(/edge e1/);
    expect(err).toMatch(/judgeContext/);
  });

  it("rejects a judge edge with a blank judgeContext", () => {
    expect(validateChainWorkflowDefinition(definition({ mode: "judge", judgeContext: "   " }))).toMatch(
      /judgeContext/,
    );
  });

  it("accepts a judge edge with judgeContext", () => {
    expect(
      validateChainWorkflowDefinition(definition({ mode: "judge", judgeContext: "continue on P0" })),
    ).toBeNull();
  });

  it("rejects a tools edge with neither list", () => {
    expect(validateChainWorkflowDefinition(definition({ mode: "tools" }))).toMatch(/toolsMustInclude/);
  });

  it("rejects a commands edge with neither list", () => {
    expect(validateChainWorkflowDefinition(definition({ mode: "commands" }))).toMatch(/commandsMustMatch/);
  });

  it("rejects an over-long command pattern", () => {
    expect(
      validateChainWorkflowDefinition(
        definition({ mode: "commands", commandsMustMatch: ["x".repeat(CHAIN_COMMAND_PATTERN_MAX_LENGTH + 1)] }),
      ),
    ).toMatch(/longer than/);
  });

  it("still accepts always edges and still catches missing nodes", () => {
    expect(validateChainWorkflowDefinition(definition({ mode: "always" }))).toBeNull();
    const broken = parseChainWorkflowDefinition({
      nodes: [{ id: "a", agentSlug: "alpha" }],
      edges: [{ id: "e9", fromNodeId: "a", toNodeId: "ghost" }],
    })!;
    expect(validateChainWorkflowDefinition(broken)).toMatch(/references missing nodes/);
  });
});

describe("judge invocation summary", () => {
  it("extracts name, command excerpt and error flag", () => {
    expect(summarizeChainToolInvocations([commit, inv("sandbox-run", { cmd: "boom" }, true)])).toEqual([
      { toolName: "sandbox-run", command: "git commit -m 'fix: thing'", isError: false },
      { toolName: "sandbox-run", command: "boom", isError: true },
    ]);
  });

  it("caps the number of invocations", () => {
    const many = Array.from({ length: 100 }, () => commit);
    expect(summarizeChainToolInvocations(many)).toHaveLength(40);
  });

  it("tolerates junk", () => {
    expect(summarizeChainToolInvocations(undefined)).toEqual([]);
    expect(summarizeChainToolInvocations([null, 3, {}])).toEqual([]);
  });
});

describe("chain result text", () => {
  it("prefers the normal result when it is non-empty", () => {
    expect(resolveChainResultText("normal result", [{ message: "pending result" }])).toBe("normal result");
  });

  it("uses pending responses when respond-to-user leaves result empty", () => {
    const resultText = resolveChainResultText("", [
      { responseId: "first", message: "Implemented the fix." },
      { responseId: "second", message: "Opened the PR." },
    ]);

    expect(resultText).toBe("Implemented the fix.\n\nOpened the PR.");
    expect(evaluateChainCommandConditions({ commandsMustMatch: ["git commit"] }, [commit])).toBe(true);
  });

  it("ignores malformed pending responses", () => {
    expect(resolveChainResultText(undefined, [null, { message: 42 }, { message: "valid" }])).toBe("valid");
    expect(resolveChainResultText(undefined, undefined)).toBe("");
  });
});
