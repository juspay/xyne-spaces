import { describe, expect, it } from "vitest";
import { formatTwinCheck, reasoningWithCheck } from "./twin-self-check.js";

describe("twin self-check line", () => {
  it("summarises the scores in plain words and flags low confidence", () => {
    expect(formatTwinCheck({ answersAsk: 0.91, grounded: 0.72, overall: 0.72, source: "jev", ms: 400 })).toBe(
      "Self-check: answers the ask 91% · grounded 72%",
    );
    expect(formatTwinCheck({ actionFits: 0.2, overall: 0.2, source: "jev", ms: 1 })).toBe(
      "Self-check: action fits 20% — low confidence, review carefully",
    );
    expect(formatTwinCheck(undefined)).toBeNull();
  });

  it("appends to reasoning, or stands alone", () => {
    const check = { answersAsk: 0.8, overall: 0.8, source: "jev" as const, ms: 1 };
    expect(reasoningWithCheck("Because [clf-a#1].", check)).toBe("Because [clf-a#1].\n\nSelf-check: answers the ask 80%");
    expect(reasoningWithCheck(undefined, check)).toBe("Self-check: answers the ask 80%");
    expect(reasoningWithCheck("r", undefined)).toBe("r");
  });
});
