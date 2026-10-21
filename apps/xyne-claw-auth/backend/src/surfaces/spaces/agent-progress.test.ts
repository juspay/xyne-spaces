import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the Spaces "agent is working" pill.
 *
 * These pin the two invariants whose absence produced a permanently stuck
 * spinner in prod on 2026-09-28:
 *   1. every payload carries `sessionId` (Spaces keys straggler suppression on
 *      it; without it the suppression silently does nothing), and
 *   2. the light and the clear agree on who is deliverable, so a pill that was
 *      lit can always be cleared.
 */

const calls = vi.hoisted(() => ({
  fetches: [] as Array<{ path: string; body: Record<string, unknown>; token: string | undefined }>,
  fail: false,
  warns: [] as string[],
}));

vi.mock("./client.js", () => ({
  spacesAppFetch: vi.fn(async (path: string, body: Record<string, unknown>, token?: string) => {
    calls.fetches.push({ path, body, token });
    if (calls.fail) throw new Error("spaces unreachable");
    return {};
  }),
}));

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((m: string) => calls.warns.push(m)),
  }),
}));

vi.mock("../../lib/errors.js", () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const {
  emitAgentProgressWorking,
  emitAgentProgressDone,
  isSpacesProgressDeliverable,
  preDispatchSessionKey,
} = await import("./agent-progress.js");

const target = {
  sessionId: "sess-1",
  conversationId: "conv-1",
  channelId: "chan-1",
  agentSlug: "askpmm",
  agentName: "askPMM",
  spacesAppUserId: "spaces-user-1",
  appToken: "token-1",
};

describe("agent progress signal", () => {
  beforeEach(() => {
    calls.fetches = [];
    calls.warns = [];
    calls.fail = false;
  });

  // ── The invariant the whole module exists for ──────────────────────────

  it("sends sessionId on the working payload", async () => {
    await emitAgentProgressWorking(target, "get_file_content");

    expect(calls.fetches).toHaveLength(1);
    expect(calls.fetches[0]!.path).toBe("/chat/agentProgress");
    expect(calls.fetches[0]!.body).toMatchObject({
      sessionId: "sess-1",
      status: "working",
      toolLabel: "get_file_content",
      conversationId: "conv-1",
      channelId: "chan-1",
      userId: "spaces-user-1",
    });
  });

  it("sends sessionId on the done payload", async () => {
    await emitAgentProgressDone(target);

    expect(calls.fetches[0]!.body).toMatchObject({ sessionId: "sess-1", status: "done" });
  });

  it("never omits sessionId — Spaces straggler suppression is keyed on it", async () => {
    await emitAgentProgressWorking(target, "a-tool");
    await emitAgentProgressDone(target);

    // A payload without sessionId is not an error on the Spaces side, it just
    // disables suppression — so the only defence is asserting it here.
    for (const call of calls.fetches) {
      expect(call.body["sessionId"]).toBe("sess-1");
      expect(call.body["sessionId"]).toBeTruthy();
    }
  });

  it("carries no toolLabel on the clear", async () => {
    await emitAgentProgressDone(target);
    expect(calls.fetches[0]!.body).not.toHaveProperty("toolLabel");
  });

  // ── Light and clear must agree on deliverability ───────────────────────

  it.each([
    ["digital-twin", { ...target, agentSlug: "digital-twin" }],
    ["no channelId", { ...target, channelId: undefined }],
    ["no appToken", { ...target, appToken: undefined }],
  ])("skips both the light and the clear for %s", async (_label, skipped) => {
    await emitAgentProgressWorking(skipped, "a-tool");
    await emitAgentProgressDone(skipped);

    expect(calls.fetches).toHaveLength(0);
    expect(isSpacesProgressDeliverable(skipped)).toBe(false);
  });

  it("uses one predicate for both directions, so a lit pill is always clearable", () => {
    // If the clear were ever stricter than the light, some surface could be lit
    // and never cleared — the exact shape of the original bug.
    expect(isSpacesProgressDeliverable(target)).toBe(true);
    expect(isSpacesProgressDeliverable({ ...target, agentSlug: undefined })).toBe(true);
  });

  it.each([
    ["no agentSlug", { ...target, agentSlug: undefined }],
    ["no agentName", { ...target, agentName: undefined }],
    ["no conversationId", { ...target, conversationId: undefined }],
  ])("clears whatever it was willing to light — %s", async (_label, partial) => {
    // Behavioural twin of the predicate test above: a clear that adds its own
    // extra condition would strand exactly the surfaces it agreed to light.
    calls.fetches = [];
    await emitAgentProgressWorking(partial, "a-tool");
    const lit = calls.fetches.length;

    calls.fetches = [];
    await emitAgentProgressDone(partial);
    const cleared = calls.fetches.length;

    expect(cleared).toBe(lit);
  });

  // ── Never break the run ────────────────────────────────────────────────

  it("swallows a Spaces failure on the working path", async () => {
    calls.fail = true;
    await expect(emitAgentProgressWorking(target, "a-tool")).resolves.toBeUndefined();
    expect(calls.warns.join(" ")).toContain("Failed to emit agent progress");
  });

  it("swallows a Spaces failure on the clear path", async () => {
    calls.fail = true;
    await expect(emitAgentProgressDone(target)).resolves.toBeUndefined();
    expect(calls.warns.join(" ")).toContain("Failed to clear agent progress signal");
  });

  // ── Pre-dispatch key ───────────────────────────────────────────────────

  it("derives a pre-dispatch key that cannot collide with a run sessionId", () => {
    const key = preDispatchSessionKey("conv-1");
    expect(key).toBe("pre-dispatch:conv-1");
    // Run sessionIds are UUIDs; the prefix guarantees no overlap.
    expect(key).not.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is stable for the same conversation, so a retried announce reuses the key", () => {
    expect(preDispatchSessionKey("conv-1")).toBe(preDispatchSessionKey("conv-1"));
    expect(preDispatchSessionKey("conv-1")).not.toBe(preDispatchSessionKey("conv-2"));
  });
});
