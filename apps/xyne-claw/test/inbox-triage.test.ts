import { describe, expect, it } from "vitest";
import { interruptFromAnswers, parseExtractArguments, triageFromAnswers } from "../src/inbox-triage.js";

describe("triageFromAnswers", () => {
  it("maps Jev answers to clamped scores and a known kind", () => {
    expect(
      triageFromAnswers({
        needsReply: { type: "noul", noul: 0.91 },
        hasDeadline: { type: "noul", noul: 1.4 },
        importance: { type: "score", score: 0.7 },
        kind: { type: "choice", choice: "deadline" },
      }),
    ).toEqual({ needsReply: 0.91, hasDeadline: 1, importance: 0.7, kind: "deadline" });
  });

  it("returns nulls for missing or unknown answers", () => {
    expect(triageFromAnswers({ kind: { type: "choice", choice: "spam" } })).toEqual({
      needsReply: null,
      hasDeadline: null,
      importance: null,
      kind: null,
    });
  });
});

describe("interruptFromAnswers", () => {
  it("reads the chosen decision and its probability", () => {
    expect(
      interruptFromAnswers({ decision: { type: "choice", choice: "text", probabilities: { text: 0.8, later: 0.2 } } }),
    ).toEqual({ decision: "text", confidence: 0.8 });
  });

  it("rejects an unknown decision", () => {
    expect(interruptFromAnswers({ decision: { type: "choice", choice: "call" } })).toBeNull();
  });
});

describe("parseExtractArguments", () => {
  it("keeps valid loops and normalises the deadline", () => {
    const result = parseExtractArguments(
      JSON.stringify({
        summary: "Hotel asks to confirm booking #4411.",
        loops: [
          {
            kind: "deadline",
            title: "Confirm hotel booking #4411",
            ask: "Reply to confirm the booking",
            counterpart: "Taj reservations",
            deadlineAt: "2026-10-14T18:00:00+05:30",
            confidence: 0.9,
          },
          { kind: "maybe", title: "dropped" },
          { kind: "awaiting_user", title: "" },
        ],
      }),
    );
    expect(result).toEqual({
      summary: "Hotel asks to confirm booking #4411.",
      loops: [
        {
          kind: "deadline",
          title: "Confirm hotel booking #4411",
          ask: "Reply to confirm the booking",
          counterpart: "Taj reservations",
          deadlineAt: "2026-10-14T12:30:00.000Z",
          confidence: 0.9,
        },
      ],
    });
  });

  it("drops an unparseable deadline and defaults confidence", () => {
    const result = parseExtractArguments(
      JSON.stringify({ summary: "", loops: [{ kind: "awaiting_them", title: "Vendor quote", deadlineAt: "soon" }] }),
    );
    expect(result?.loops[0]).toMatchObject({ deadlineAt: null, confidence: 0.5, ask: null });
  });

  it("returns null for non-JSON", () => {
    expect(parseExtractArguments("not json")).toBeNull();
  });
});
