import { describe, expect, it, vi } from "vitest";
import { decideBatch, formatDecisions, readAnswer, toXorQuestions, validateQuestions, type DecideQuestion } from "../src/xor-decide.js";

const Q: DecideQuestion[] = [
  { id: "failure", question: "Is this a real failure?", type: "yesno" },
  { id: "component", question: "Which component?", type: "choice", options: { api: "API", db: "Database", auth: "Auth" } },
  { id: "severity", question: "How severe?", type: "score", options: ["low", "medium", "high"] },
  { id: "ticket", question: "Ticket id mentioned?", type: "value", dtype: "string", expect: "XYNE-1" },
];

describe("validateQuestions", () => {
  it("accepts the four types and normalises dtype and threshold", () => {
    const v = validateQuestions([...Q, { id: "n", question: "Count?", type: "value", dtype: "int", threshold: 3 }]);
    expect("questions" in v && v.questions.map((q) => q.type)).toEqual(["yesno", "choice", "score", "value", "value"]);
    expect("questions" in v && v.questions[4]).toMatchObject({ dtype: "int", threshold: 1 });
  });

  it.each([
    [[], /non-empty/],
    [[{ id: "a b", question: "x", type: "yesno" }], /unique id/],
    [[{ id: "a", question: "", type: "yesno" }], /question text/],
    [[{ id: "a", question: "x", type: "maybe" }], /type must be/],
    [[{ id: "a", question: "x", type: "choice", options: { only: "one" } }], /at least 2 keys/],
    [[{ id: "a", question: "x", type: "score", options: { a: "b" } }], /ordered list/],
    [[{ id: "a", question: "x", type: "value", dtype: "date" }], /dtype/],
    [[{ id: "a", question: "x", type: "yesno" }, { id: "a", question: "y", type: "yesno" }], /unique id/],
  ])("rejects %j", (raw, msg) => {
    const v = validateQuestions(raw);
    expect("error" in v && v.error).toMatch(msg);
  });
});

describe("toXorQuestions", () => {
  it("maps to xor question types", () => {
    expect(toXorQuestions(Q)).toEqual({
      failure: { type: "noul", instructions: "Is this a real failure?" },
      component: { type: "choice", instructions: "Which component?", criteria: { api: "API", db: "Database", auth: "Auth" } },
      severity: { type: "score", instructions: "How severe?", criteria: ["low", "medium", "high"] },
      ticket: { type: "value", instructions: "Ticket id mentioned?", dtype: "string" },
    });
  });
});

describe("readAnswer", () => {
  it("turns noul into a boolean with 2|p-0.5| confidence", () => {
    expect(readAnswer(Q[0]!, { type: "noul", noul: 0.95 })).toEqual({ value: true, confidence: 0.9, unsure: false });
    expect(readAnswer(Q[0]!, { type: "noul", noul: 0.4 })).toEqual({ value: false, confidence: 0.2, unsure: true });
  });

  it("reads choice, score levels and values, and compares expect in code", () => {
    expect(readAnswer(Q[1]!, { type: "choice", choice: "db", confidence: 0.81 })).toEqual({ value: "db", confidence: 0.81, unsure: false });
    expect(readAnswer(Q[2]!, { type: "score", score: 1, confidence: 0.9 }).value).toBe("high");
    expect(readAnswer(Q[2]!, { type: "score", score: 0.5, confidence: 0.9 }).value).toBe("medium");
    expect(readAnswer(Q[3]!, { type: "value", value: " xyne-1 ", confidence: 0.99 })).toEqual({ value: " xyne-1 ", confidence: 0.99, unsure: false, ok: true });
    expect(readAnswer(Q[3]!, { type: "value", value: "XYNE-2", confidence: 0.99 }).ok).toBe(false);
  });

  it("marks missing answers unsure", () => {
    expect(readAnswer(Q[1]!, undefined)).toEqual({ value: null, confidence: null, unsure: true });
  });
});

describe("decideBatch", () => {
  it("sends one xor call per item with all questions, passes images, and summarises", async () => {
    const ask = vi.fn(async (req: { state: string; images?: string[] }) => {
      if (req.state.includes("down")) return null;
      const failing = req.state.includes("ERROR");
      return {
        failure: { type: "noul", noul: failing ? 0.97 : 0.05 },
        component: { type: "choice", choice: failing ? "db" : "api", confidence: 0.9 },
        severity: { type: "score", score: failing ? 1 : 0, confidence: 0.8 },
        ticket: { type: "value", value: failing ? "XYNE-1" : null, confidence: failing ? 0.95 : 0.2 },
      };
    });
    const res = await decideBatch({
      items: [
        { id: "l1", text: "ERROR db connection refused (XYNE-1)" },
        { id: "l2", text: "INFO request served" },
        { id: "l3", text: "grid down" },
        { id: "s1", image: "data:image/png;base64,AAAA" },
      ],
      questions: Q,
      context: "Production log lines from xyne-claw.",
      ask: ask as never,
    });
    expect(ask).toHaveBeenCalledTimes(4);
    const first = ask.mock.calls[0]![0] as { state: string; questions: Record<string, unknown> };
    expect(first.state).toBe("Production log lines from xyne-claw.\n\nERROR db connection refused (XYNE-1)");
    expect(Object.keys(first.questions)).toEqual(["failure", "component", "severity", "ticket"]);
    expect((ask.mock.calls[3]![0] as { images?: string[] }).images).toEqual(["data:image/png;base64,AAAA"]);
    expect(res.unavailable).toBe(1);
    expect(res.items[2]).toMatchObject({ id: "l3", error: "xor unavailable" });
    const failure = res.summary.find((s) => s.id === "failure")!;
    expect(failure.distribution).toEqual({ true: 1, false: 2 });
    expect(res.summary.find((s) => s.id === "ticket")).toMatchObject({ failedExpect: 0 });
    const table = formatDecisions(Q, res);
    expect(table.split("\n")[0]).toBe("xor-decide: 4 item(s) × 4 question(s) — 1 unavailable");
    expect(table).toContain("| l1 | true (0.94) | db (0.9) | high (0.8) | XYNE-1✓ (0.95) |");
    expect(table).toContain("| l3 | — | — | — | — |");
  });
});
