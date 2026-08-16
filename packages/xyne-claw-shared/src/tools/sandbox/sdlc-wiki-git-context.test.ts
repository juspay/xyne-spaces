import { describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "../types.js";
import {
  sdlcGitContext,
  isStaleSessionError,
  truncateWikiGitOutput,
  WIKI_GIT_COMMAND_TIMEOUT_MS,
  WIKI_GIT_METADATA_TIMEOUT_MS,
  withWikiGitWallClockTimeout,
  wikiGitOutputBudgetKey,
  resolveWikiGitCommitRef,
  sanitizeWikiGitCommitOutput,
} from "./tools.js";

const SHA = "a".repeat(40);

function context(meta: Record<string, string>): ToolExecutionContext {
  return { config: {}, meta };
}

function wikiContext(extra: Record<string, string> = {}): ToolExecutionContext {
  return context({
    sdlcWikiRun: "true",
    sdlcWikiRole: "GENERATOR",
    sdlcExecutionId: "execution-1",
    userId: "user-1",
    agentSlug: "sdlc-agent",
    sdlcWikiAssignedCommitShas: JSON.stringify([SHA]),
    ...extra,
  });
}

describe("SDLC Wiki Git context guardrails", () => {
  it.each([
    ["commit_context", ["operation", "commitSha"]],
    ["range_context", ["operation", "beforeSha", "afterSha"]],
    ["read_file", ["operation", "commitSha", "path"]],
    ["list_tree", ["operation", "commitSha"]],
    ["search", ["operation", "commitSha", "pattern"]],
    ["path_history", ["operation", "commitSha", "path"]],
  ])("declares required fields for %s", (operation, required) => {
    const variants = sdlcGitContext.inputSchema.oneOf as Array<{
      properties: { operation?: { const?: string } };
      required: string[];
    }>;
    const variant = variants.find(candidate => candidate.properties.operation?.const === operation);
    expect(variant?.required).toEqual(required);
  });

  it("declares integer patch and output bounds", () => {
    const properties = sdlcGitContext.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties["offset"]).toMatchObject({ type: "integer", minimum: 0 });
    expect(properties["maxBytes"]).toMatchObject({ type: "integer", minimum: 1_000, maximum: 500_000 });
  });

  it("rejects use outside a trusted Wiki run", async () => {
    await expect(
      sdlcGitContext.execute({ operation: "commit_context", commitSha: SHA }, context({})),
    ).resolves.toBe("Error: tool is restricted to SDLC Wiki runs.");
  });

  it("rejects arbitrary commit identities before sandbox access", async () => {
    await expect(
      sdlcGitContext.execute(
        { operation: "commit_context", commitSha: "b".repeat(40) },
        wikiContext(),
      ),
    ).resolves.toBe("Error: commit is not assigned to this Wiki run.");
  });

  it("rejects an unassigned boundary for aggregate range context", async () => {
    await expect(
      sdlcGitContext.execute(
        { operation: "range_context", beforeSha: "b".repeat(40), afterSha: SHA },
        wikiContext(),
      ),
    ).resolves.toBe("Error: range boundary is not assigned to this Wiki run.");
  });

  it("resolves only unique assigned refs with at least nine characters", () => {
    const first = `${"a".repeat(9)}1${"0".repeat(30)}`;
    const second = `${"a".repeat(9)}2${"0".repeat(30)}`;
    const allowed = new Set([first, second]);
    expect(resolveWikiGitCommitRef(`${"a".repeat(9)}1`, allowed)).toBe(first);
    expect(resolveWikiGitCommitRef("a".repeat(9), allowed)).toBeNull();
    expect(resolveWikiGitCommitRef("a".repeat(8), allowed)).toBeNull();
    expect(resolveWikiGitCommitRef(first, allowed)).toBe(first);
  });

  it("replaces canonical commit identities in Git output with the assigned display ref", () => {
    const displayRef = SHA.slice(0, 9);
    const output = `commit ${SHA}\nparent ${SHA}\n`;
    const sanitized = sanitizeWikiGitCommitOutput(output, SHA, displayRef);

    expect(sanitized).toBe(`commit ${displayRef}\nparent ${displayRef}\n`);
    expect(sanitized).not.toContain(SHA);
  });

  it("rejects traversal and invalid patch offsets before sandbox access", async () => {
    await expect(
      sdlcGitContext.execute(
        { operation: "read_file", commitSha: SHA, path: "../secret" },
        wikiContext(),
      ),
    ).resolves.toBe("Error: invalid repository-relative path.");
    await expect(
      sdlcGitContext.execute(
        { operation: "read_patch", commitSha: SHA, offset: -1 },
        wikiContext(),
      ),
    ).resolves.toBe("Error: offset must be a non-negative integer.");
    await expect(
      sdlcGitContext.execute(
        { operation: "read_patch", commitSha: SHA, maxBytes: 999 },
        wikiContext(),
      ),
    ).resolves.toBe("Error: maxBytes must be an integer between 1000 and 500000.");
  });

  it("caps output by UTF-8 bytes and resets the cumulative key per Agent Session", () => {
    const bounded = truncateWikiGitOutput("a🙂b", 5);
    expect(bounded.totalBytes).toBe(6);
    expect(Buffer.byteLength(bounded.value, "utf8")).toBeLessThanOrEqual(5);
    expect(bounded.truncated).toBe(true);

    const first = wikiContext({ sdlcSessionId: "session-1" });
    const second = wikiContext({ sdlcSessionId: "session-2" });
    expect(wikiGitOutputBudgetKey(first, "execution-store")).not.toBe(
      wikiGitOutputBudgetKey(second, "execution-store"),
    );
  });

  it("returns the sandbox recreation signal when the reusable session is absent", async () => {
    await expect(
      sdlcGitContext.execute(
        { operation: "commit_context", commitSha: SHA },
        wikiContext({
          sdlcRepositoryId: "repo-1",
          sdlcRepositoryName: "public-repo",
          sdlcRepositoryUrl: "https://github.com/example/public-repo",
          sdlcRepositoryBaseBranch: "main",
        }),
      ),
    ).resolves.toBe("Error: no sandbox session — call sandbox-repo-setup first.");
  });

  it("recognizes stale sandbox failures and keeps Git command time bounded", () => {
    expect(isStaleSessionError(new Error("sandbox claim not found"))).toBe(true);
    expect(isStaleSessionError(new Error("ECONNRESET"))).toBe(true);
    expect(isStaleSessionError(new Error("git object missing"))).toBe(false);
    expect(WIKI_GIT_METADATA_TIMEOUT_MS).toBeLessThan(WIKI_GIT_COMMAND_TIMEOUT_MS);
    expect(WIKI_GIT_COMMAND_TIMEOUT_MS).toBe(120_000);
  });

  it("enforces a wall-clock deadline when the sandbox SDK never settles", async () => {
    const neverSettles = new Promise<never>(() => undefined);

    await expect(withWikiGitWallClockTimeout(() => neverSettles, 5)).rejects.toThrow(
      "Wiki Git sandbox command exceeded the 5ms wall-clock deadline",
    );
  });

  it("arms the deadline before invoking the sandbox SDK", async () => {
    let invoked = false;
    const operation = withWikiGitWallClockTimeout(() => {
      invoked = true;
      return new Promise<never>(() => undefined);
    }, 5);

    expect(invoked).toBe(false);
    await expect(operation).rejects.toThrow("wall-clock deadline");
    expect(invoked).toBe(true);
  });
});
