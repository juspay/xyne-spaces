import { describe, it, expect } from "vitest";
import { sandboxCopyIn } from "./tools.js";
import type { ToolExecutionContext } from "../types.js";

// A run context that has a materialized skills root + a plausible session owner.
// The path-confinement / validation branches all return BEFORE any sandbox
// session lookup, so these cases never need a live SESSION_STORE entry.
function ctx(skillsRoot: string | undefined): ToolExecutionContext {
  return {
    config: {},
    meta: {
      userId: "u1",
      conversationId: "c1",
      agentSlug: "a1",
      ...(skillsRoot ? { skillsRoot } : {}),
    },
  };
}

describe("sandbox-copy-in tool definition", () => {
  it("is a custom sandbox tool with the expected slug", () => {
    expect(sandboxCopyIn.slug).toBe("sandbox-copy-in");
    expect(sandboxCopyIn.source).toBe("custom:sandbox");
  });

  it("requires sessionId and skillPath", () => {
    expect(sandboxCopyIn.inputSchema.required).toEqual(
      expect.arrayContaining(["sessionId", "skillPath"]),
    );
  });

  it("is NOT an approval-gated write tool (server-side copy, no user data mutation)", () => {
    // It writes into an ephemeral sandbox the agent already owns — same trust
    // level as sandbox-write-file, which is also not approval-gated.
    expect(sandboxCopyIn.isWriteTool).toBeFalsy();
  });
});

describe("sandbox-copy-in path confinement", () => {
  const ROOT = "/data/session-skills/sess-123";

  it("refuses when no skills are materialized for the run", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "slug/scripts/run.sh" },
      ctx(undefined),
    );
    expect(out.toLowerCase()).toContain("no skills are materialized");
  });

  it("rejects an empty skillPath", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "   " },
      ctx(ROOT),
    );
    expect(out.toLowerCase()).toContain("non-empty");
  });

  it("rejects '..' traversal that escapes the skills root", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "../../etc/passwd" },
      ctx(ROOT),
    );
    expect(out.toLowerCase()).toContain("escapes the skill directory");
  });

  it("rejects a sibling-prefix escape (root-name is a prefix, not a parent)", async () => {
    // /data/session-skills/sess-123-evil must NOT be accepted just because it
    // starts with the root string — the separator check guards this.
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "../sess-123-evil/secret" },
      ctx(ROOT),
    );
    expect(out.toLowerCase()).toContain("escapes the skill directory");
  });

  it("neutralizes a leading '/' into the root instead of treating it as absolute", async () => {
    // path.join strips the leading slash, so '/etc/shadow' resolves to
    // <root>/etc/shadow — confined inside the root, NOT an escape. It clears
    // confinement and fails later on the missing session (safe outcome).
    const out = await sandboxCopyIn.execute(
      { sessionId: "no-such-session", skillPath: "/etc/shadow" },
      ctx(ROOT),
    );
    expect(out).toContain("no-such-session");
    expect(out.toLowerCase()).toContain("not found");
  });

  it("refuses paths that resolve to a credential file even inside the root", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "slug/.ssh/id_rsa" },
      ctx(ROOT),
    );
    expect(out.toLowerCase()).toContain("credential");
  });

  it("passes confinement for a normal in-root path, then fails only on the missing session", async () => {
    // A legit relative path clears every validation branch and reaches the
    // session lookup — proving the guards don't false-reject valid input.
    const out = await sandboxCopyIn.execute(
      { sessionId: "no-such-session", skillPath: "slug/scripts/run.sh" },
      ctx(ROOT),
    );
    expect(out).toContain("no-such-session");
    expect(out.toLowerCase()).toContain("not found");
  });
});
