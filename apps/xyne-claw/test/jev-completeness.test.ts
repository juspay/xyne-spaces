import { describe, expect, it, vi, beforeEach } from "vitest";

const ask = vi.fn();
vi.mock("../src/jev.js", () => ({
  jevEnabled: () => true,
  jevThreshold: (_n: string, fallback: number) => fallback,
  jevAsk: (...args: unknown[]) => ask(...args),
}));

const { assessAnswer } = await import("../src/jev-completeness.js");

function scores(answered: number, finished: number, intent: number) {
  ask.mockResolvedValue({
    answered: { type: "noul", noul: answered },
    finished: { type: "noul", noul: finished },
    intent: { type: "noul", noul: intent },
  });
}

beforeEach(() => ask.mockReset());

describe("answer completeness", () => {
  it("passes a delivered answer", async () => {
    scores(0.95, 0.9, 0.05);
    const out = await assessAnswer({ task: "how many tickets?", answer: "There are 42 open tickets." });
    expect(out?.verdict).toBe("complete");
  });

  it("flags a promise to do the work as intent-only", async () => {
    scores(0.1, 0.2, 0.95);
    const out = await assessAnswer({
      task: "summarize the last 7 days",
      answer: "I'll pull the last 7 days from that channel.",
    });
    expect(out?.verdict).toBe("intent-only");
  });

  it("flags work that stopped partway as partial", async () => {
    scores(0.8, 0.2, 0.1);
    const out = await assessAnswer({ task: "summarize", answer: "Here is what I found so far:" });
    expect(out?.verdict).toBe("partial");
  });

  it("returns null when there is nothing to judge", async () => {
    expect(await assessAnswer({ task: "", answer: "x" })).toBeNull();
    expect(await assessAnswer({ task: "x", answer: "   " })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("returns null when scoring is unavailable, so the caller does not continue", async () => {
    ask.mockResolvedValue(null);
    expect(await assessAnswer({ task: "x", answer: "y" })).toBeNull();
  });

  it("includes open plan items in what it shows Jev", async () => {
    scores(0.9, 0.9, 0.1);
    await assessAnswer({ task: "do it", answer: "done", pendingPlanItems: 2 });
    expect(String(ask.mock.calls[0]?.[0])).toContain("Plan items still open");
  });
});
