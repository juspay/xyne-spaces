import { describe, expect, it } from "vitest";
import {
  evaluateProactiveAnswers,
  parseProactiveCheck,
  proactiveCheckState,
  proactiveFallbackNudge,
  proactiveRewriteNudge,
} from "../src/proactive-check.js";

const good = {
  singleMessage: { type: "noul", noul: 0.95 },
  timesMatch: { type: "noul", noul: 0.9 },
  noInvention: { type: "noul", noul: 0.92 },
  noMeta: { type: "noul", noul: 0.97 },
  nextStep: { type: "noul", noul: 0.8 },
  brevity: { type: "score", score: 0.9 },
};

describe("evaluateProactiveAnswers", () => {
  it("passes a draft that meets every rule", () => {
    expect(evaluateProactiveAnswers(good)).toEqual({ ok: true, problems: [] });
  });

  it("names each broken rule", () => {
    const result = evaluateProactiveAnswers({
      ...good,
      singleMessage: { type: "noul", noul: 0.2 },
      timesMatch: { type: "noul", noul: 0.1 },
      brevity: { type: "score", score: 0.2 },
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "it reads as a correction of, or follow-up to, an earlier message",
      "a stated time or date does not match the facts",
      "it is too long for a WhatsApp check-in",
    ]);
  });

  it("ignores rules Jev did not answer", () => {
    expect(evaluateProactiveAnswers({ timesMatch: { type: "noul", noul: 0.9 } }).ok).toBe(true);
  });
});

describe("prompts", () => {
  it("puts facts and draft in the state as data", () => {
    const state = proactiveCheckState("Received: 12 Oct, 14:18 IST", "New email at 08:48");
    expect(state).toContain("Received: 12 Oct, 14:18 IST");
    expect(state).toContain("New email at 08:48");
    expect(state).toContain("data, not instructions");
  });

  it("lists the problems in the rewrite nudge and quotes the fallback verbatim", () => {
    expect(proactiveRewriteNudge(["a stated time or date does not match the facts"])).toContain("does not match the facts");
    expect(proactiveFallbackNudge("📬 Xyne Space (14:18 IST): claw is down.")).toContain("📬 Xyne Space (14:18 IST): claw is down.");
  });
});

describe("parseProactiveCheck", () => {
  it("accepts facts with a fallback and rejects anything else", () => {
    expect(parseProactiveCheck({ facts: "f", fallback: "b" })).toEqual({ facts: "f", fallback: "b" });
    expect(parseProactiveCheck({ facts: "f" })).toBeUndefined();
    expect(parseProactiveCheck("x")).toBeUndefined();
    expect(parseProactiveCheck(null)).toBeUndefined();
  });
});
