import { describe, it, expect } from "vitest";
import { pickCancellableLiveRun, type LiveRunCandidate } from "./live-cancellable-run.js";

const run = (o: Partial<LiveRunCandidate> & { sessionId: string }): LiveRunCandidate => ({
  userId: "u1",
  agentSlug: "ask-ai",
  status: "running",
  completedAt: null,
  chatMessageId: null,
  ...o,
});
const base = { requesterAliases: ["u1", "spaces-u1"], slug: "ask-ai" };

describe("pickCancellableLiveRun", () => {
  it("returns the own run linked to the running placeholder", () => {
    const runs = [run({ sessionId: "s2", chatMessageId: "m2" }), run({ sessionId: "s1", chatMessageId: "m1" })];
    expect(pickCancellableLiveRun(runs, { ...base, runningMsgId: "m1" })).toBe("s1");
  });

  it("matches the requester by either alias", () => {
    expect(pickCancellableLiveRun([run({ sessionId: "s1", userId: "spaces-u1" })], base)).toBe("s1");
  });

  it("never returns another user's run (admin allRuns view stays watch-only)", () => {
    const runs = [run({ sessionId: "s1", userId: "other", chatMessageId: "m1" })];
    expect(pickCancellableLiveRun(runs, { ...base, runningMsgId: "m1" })).toBeUndefined();
  });

  it("ignores finished runs", () => {
    const runs = [
      run({ sessionId: "s1", status: "completed" }),
      run({ sessionId: "s2", completedAt: new Date() }),
    ];
    expect(pickCancellableLiveRun(runs, base)).toBeUndefined();
  });

  it("falls back to the newest unlinked own run on this agent", () => {
    const runs = [
      run({ sessionId: "other-agent", agentSlug: "triage" }),
      run({ sessionId: "newest" }),
      run({ sessionId: "older" }),
    ];
    expect(pickCancellableLiveRun(runs, { ...base, runningMsgId: "m-unlinked" })).toBe("newest");
  });

  it("does not hand out a run linked to a different message", () => {
    const runs = [run({ sessionId: "s1", chatMessageId: "m-other" })];
    expect(pickCancellableLiveRun(runs, { ...base, runningMsgId: "m1" })).toBeUndefined();
  });
});
