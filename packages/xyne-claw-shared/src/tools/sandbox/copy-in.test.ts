import { describe, it, expect } from "vitest";
import { sandboxCopyIn } from "./tools.js";
import type { ToolExecutionContext } from "../types.js";

// A run context that can carry a materialized skills root and/or a .context root.
// The path-confinement / validation branches all return BEFORE any sandbox
// session lookup, so these cases never need a live SESSION_STORE entry.
function ctx(opts: { skillsRoot?: string; contextRoot?: string } = {}): ToolExecutionContext {
  return {
    config: {},
    meta: {
      userId: "u1",
      conversationId: "c1",
      agentSlug: "a1",
      ...(opts.skillsRoot ? { skillsRoot: opts.skillsRoot } : {}),
      ...(opts.contextRoot ? { contextRoot: opts.contextRoot } : {}),
    },
  };
}

describe("sandbox-copy-in tool definition", () => {
  it("is a custom sandbox tool with the expected slug", () => {
    expect(sandboxCopyIn.slug).toBe("sandbox-copy-in");
    expect(sandboxCopyIn.source).toBe("custom:sandbox");
  });

  it("requires only sessionId (skillPath/contextPath are XOR, enforced at runtime)", () => {
    expect(sandboxCopyIn.inputSchema.required).toEqual(["sessionId"]);
  });

  it("exposes both skillPath and contextPath inputs", () => {
    const props = sandboxCopyIn.inputSchema.properties ?? {};
    expect(props).toHaveProperty("skillPath");
    expect(props).toHaveProperty("contextPath");
  });

  it("is NOT an approval-gated write tool (server-side copy, no user data mutation)", () => {
    // It writes into an ephemeral sandbox the agent already owns — same trust
    // level as sandbox-write-file, which is also not approval-gated.
    expect(sandboxCopyIn.isWriteTool).toBeFalsy();
  });
});

describe("sandbox-copy-in source selection (skillPath XOR contextPath)", () => {
  const ROOT = "/data/session-skills/sess-123";

  it("rejects when neither skillPath nor contextPath is given", async () => {
    const out = await sandboxCopyIn.execute({ sessionId: "s" }, ctx({ skillsRoot: ROOT }));
    expect(out.toLowerCase()).toContain("exactly one");
  });

  it("rejects when BOTH skillPath and contextPath are given", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "slug/run.sh", contextPath: "tool-results/x.json" },
      ctx({ skillsRoot: ROOT, contextRoot: "/data/sessions/c1/.context" }),
    );
    expect(out.toLowerCase()).toContain("exactly one");
  });

  it("treats a blank skillPath as 'not provided' (falls into the XOR error)", async () => {
    const out = await sandboxCopyIn.execute({ sessionId: "s", skillPath: "   " }, ctx({ skillsRoot: ROOT }));
    expect(out.toLowerCase()).toContain("exactly one");
  });
});

describe("sandbox-copy-in path confinement (skillPath)", () => {
  const ROOT = "/data/session-skills/sess-123";

  it("refuses when no skills are materialized for the run", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "slug/scripts/run.sh" },
      ctx({}),
    );
    expect(out.toLowerCase()).toContain("no skills are materialized");
  });

  it("rejects '..' traversal that escapes the skills root", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "../../etc/passwd" },
      ctx({ skillsRoot: ROOT }),
    );
    expect(out.toLowerCase()).toContain("escapes its root");
  });

  it("rejects a sibling-prefix escape (root-name is a prefix, not a parent)", async () => {
    // /data/session-skills/sess-123-evil must NOT be accepted just because it
    // starts with the root string — the separator check guards this.
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "../sess-123-evil/secret" },
      ctx({ skillsRoot: ROOT }),
    );
    expect(out.toLowerCase()).toContain("escapes its root");
  });

  it("neutralizes a leading '/' into the root instead of treating it as absolute", async () => {
    // path.join strips the leading slash, so '/etc/shadow' resolves to
    // <root>/etc/shadow — confined inside the root, NOT an escape. It clears
    // confinement and fails later on the missing session (safe outcome).
    const out = await sandboxCopyIn.execute(
      { sessionId: "no-such-session", skillPath: "/etc/shadow" },
      ctx({ skillsRoot: ROOT }),
    );
    expect(out).toContain("no-such-session");
    expect(out.toLowerCase()).toContain("not found");
  });

  it("refuses paths that resolve to a credential file even inside the root", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", skillPath: "slug/.ssh/id_rsa" },
      ctx({ skillsRoot: ROOT }),
    );
    expect(out.toLowerCase()).toContain("credential");
  });

  it("passes confinement for a normal in-root path, then fails only on the missing session", async () => {
    // A legit relative path clears every validation branch and reaches the
    // session lookup — proving the guards don't false-reject valid input.
    const out = await sandboxCopyIn.execute(
      { sessionId: "no-such-session", skillPath: "slug/scripts/run.sh" },
      ctx({ skillsRoot: ROOT }),
    );
    expect(out).toContain("no-such-session");
    expect(out.toLowerCase()).toContain("not found");
  });
});

describe("sandbox-copy-in path confinement (contextPath)", () => {
  const CTX_ROOT = "/data/sessions/c1/.context";

  it("refuses when no .context root exists for the run", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", contextPath: "tool-results/x.json" },
      ctx({ skillsRoot: "/data/session-skills/sess-123" }),
    );
    expect(out.toLowerCase()).toContain(".context root");
  });

  it("rejects '..' traversal that escapes the .context root", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", contextPath: "../../etc/passwd" },
      ctx({ contextRoot: CTX_ROOT }),
    );
    expect(out.toLowerCase()).toContain("escapes its root");
  });

  it("refuses a credential file even inside the .context root", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "s", contextPath: ".ssh/id_rsa" },
      ctx({ contextRoot: CTX_ROOT }),
    );
    expect(out.toLowerCase()).toContain("credential");
  });

  it("passes confinement for a normal tool-results path, then fails only on the missing session", async () => {
    const out = await sandboxCopyIn.execute(
      { sessionId: "no-such-session", contextPath: "tool-results/juspay_alerts-x.json" },
      ctx({ contextRoot: CTX_ROOT }),
    );
    expect(out).toContain("no-such-session");
    expect(out.toLowerCase()).toContain("not found");
  });
});
