import { describe, expect, it } from "vitest";
import { decideSandboxPreviewAnnounce, explicitSandboxSessionId, isRefusalToolResult } from "../src/sandbox-preview-announce.js";

// XYNE-66338: a run that touches several sandboxes must announce each writable
// one exactly once, and never the shared read-only sbx-git sandbox.

const SBX_GIT = "sbx-git-template-abc12";
const WRITABLE_A = "agent-workspace-warmpool-a-xfqwz";
const WRITABLE_B = "agent-workspace-warmpool-b-k9p2m";
const FOREIGN = "agent-workspace-warmpool-other-user-zz9";

function harness(initialBinding?: string) {
  const store = new Map<string, { id: string }>();
  for (const id of [SBX_GIT, WRITABLE_A, WRITABLE_B, FOREIGN]) store.set(id, { id });
  if (initialBinding) store.set("conv-1", { id: initialBinding });
  const announced = new Set<string>();
  const shared = new Set([SBX_GIT]);
  const foreign = new Set([FOREIGN]);
  const step = (toolArgs: unknown = {}, toolResult: unknown = "ok") => {
    const d = decideSandboxPreviewAnnounce({
      toolArgs,
      toolResult,
      storeKey: "conv-1",
      announced,
      getSession: (k) => store.get(k),
      isOwned: (k) => {
        const id = store.get(k)?.id;
        return !!id && !foreign.has(id);
      },
      isSharedOrReadOnly: (id) => shared.has(id),
    });
    if (d.announce) announced.add(d.sandboxId);
    return d;
  };
  const bind = (id: string) => store.set("conv-1", { id });
  return { step, bind, announced };
}

describe("decideSandboxPreviewAnnounce", () => {
  it("skips sbx-git and announces the writable sandbox the run moves to", () => {
    const h = harness(SBX_GIT);
    expect(h.step()).toEqual({ announce: false, reason: "shared-readonly", sandboxId: SBX_GIT });
    h.bind(WRITABLE_A);
    expect(h.step()).toEqual({ announce: true, sandboxId: WRITABLE_A });
    expect([...h.announced]).toEqual([WRITABLE_A]);
  });

  it("announces two different writable sandboxes in one run", () => {
    const h = harness(WRITABLE_A);
    expect(h.step().announce).toBe(true);
    h.bind(WRITABLE_B);
    expect(h.step()).toEqual({ announce: true, sandboxId: WRITABLE_B });
    expect(h.announced.size).toBe(2);
  });

  it("does not re-announce a sandbox already announced in the run", () => {
    const h = harness(WRITABLE_A);
    expect(h.step().announce).toBe(true);
    expect(h.step()).toEqual({ announce: false, reason: "already-announced", sandboxId: WRITABLE_A });
  });

  it("prefers the sandbox the tool call explicitly targeted over the conversation binding", () => {
    const h = harness(SBX_GIT);
    expect(h.step({ sessionId: WRITABLE_B, cmd: "ls" })).toEqual({ announce: true, sandboxId: WRITABLE_B });
  });

  it("never announces sbx-git even when explicitly targeted", () => {
    const h = harness(WRITABLE_A);
    expect(h.step({ sessionId: SBX_GIT }).announce).toBe(false);
  });

  it("falls back to the binding when the explicit sessionId is unknown", () => {
    const h = harness(WRITABLE_A);
    expect(h.step({ sessionId: "gone-session" })).toEqual({ announce: true, sandboxId: WRITABLE_A });
  });

  it("never announces a sandbox the run does not own, even when explicitly targeted", () => {
    const h = harness(WRITABLE_A);
    expect(h.step({ sessionId: FOREIGN })).toEqual({ announce: false, reason: "not-owned", sandboxId: FOREIGN });
    expect(h.announced.size).toBe(0);
  });

  it("does not announce the conversation binding when it is not owned by the run", () => {
    const h = harness(FOREIGN);
    expect(h.step()).toEqual({ announce: false, reason: "not-owned", sandboxId: FOREIGN });
  });

  it("does not announce when the sandbox tool refused with an Error: text result", () => {
    const h = harness(WRITABLE_A);
    const refusal = `Error: Session ${FOREIGN} is not authorized for this user/conversation.`;
    expect(h.step({ sessionId: FOREIGN }, refusal)).toEqual({ announce: false, reason: "tool-error" });
    expect(h.step({}, { content: [{ type: "text", text: refusal }] })).toEqual({ announce: false, reason: "tool-error" });
    expect(h.announced.size).toBe(0);
  });

  it("reports no-session when nothing is bound", () => {
    const h = harness();
    expect(h.step()).toEqual({ announce: false, reason: "no-session" });
  });
});

describe("isRefusalToolResult", () => {
  it("flags Error: text in string and content-part results only", () => {
    expect(isRefusalToolResult("Error: Session s1 not found.")).toBe(true);
    expect(isRefusalToolResult({ content: [{ type: "text", text: "  Error: nope" }] })).toBe(true);
    expect(isRefusalToolResult('{"stdout":"Error: in output","exitCode":1}')).toBe(false);
    expect(isRefusalToolResult({ content: [{ type: "text", text: "done" }] })).toBe(false);
    expect(isRefusalToolResult(undefined)).toBe(false);
  });
});

describe("explicitSandboxSessionId", () => {
  it("reads only non-empty string sessionId", () => {
    expect(explicitSandboxSessionId({ sessionId: " s1 " })).toBe("s1");
    expect(explicitSandboxSessionId({ sessionId: "" })).toBeUndefined();
    expect(explicitSandboxSessionId({ sessionId: 42 })).toBeUndefined();
    expect(explicitSandboxSessionId(null)).toBeUndefined();
  });
});
