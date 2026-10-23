import { describe, expect, it, vi } from "vitest";

vi.mock("../services/xorTryClient.js", () => ({ tryChecksViaClaw: vi.fn() }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { xorDecideNode, decided, unsure } = await import("./decide.js");

const QUESTIONS = [{ id: "broken", type: "yesno" as const, question: "Is it broken?" }];
type Ledger = { decision?: import("./decide.js").Decision };

describe("xorDecideNode", () => {
  it("asks xor about the state and stores the answers on the ledger", async () => {
    const ask = vi.fn(async () => ({ ok: true as const, answers: { broken: { value: true, confidence: 0.9, unsure: false } }, unavailable: false, ms: 5 }));
    const node = xorDecideNode<Ledger, { text: string }>({ questions: QUESTIONS, state: (_l, ctx) => ctx.text, context: "ctx", ask });
    const result = await node.run!({}, { text: "  the run report  " });
    expect(ask).toHaveBeenCalledWith({ questions: QUESTIONS, item: { text: "the run report" }, context: "ctx" });
    expect(result).toEqual({ ledger: { decision: { answers: { broken: { value: true, confidence: 0.9, unsure: false } }, unavailable: false } } });
  });

  it("marks the decision unavailable when xor fails or there is nothing to judge", async () => {
    const ask = vi.fn(async () => ({ ok: false as const, status: 503, error: "xor is not configured" }));
    const node = xorDecideNode<Ledger, { text: string }>({ questions: QUESTIONS, state: (_l, ctx) => ctx.text, ask });
    expect((await node.run!({}, { text: "report" }))?.ledger?.decision).toEqual({ answers: {}, unavailable: true, error: "xor is not configured" });
    expect((await node.run!({}, { text: "   " }))?.ledger?.decision).toEqual({ answers: {}, unavailable: true, error: "nothing to judge" });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("decided / unsure", () => {
  const sure = { answers: { broken: { value: true, confidence: 0.9, unsure: false } }, unavailable: false };
  const doubtful = { answers: { broken: { value: true, confidence: 0.4, unsure: true } }, unavailable: false };
  it("only counts a confident answer as decided", () => {
    expect(decided(sure, "broken", true)).toBe(true);
    expect(decided(sure, "broken", false)).toBe(false);
    expect(decided(doubtful, "broken", true)).toBe(false);
  });
  it("treats low confidence, a missing answer and an outage as unsure", () => {
    expect(unsure(sure, "broken")).toBe(false);
    expect(unsure(doubtful, "broken")).toBe(true);
    expect(unsure(sure, "other")).toBe(true);
    expect(unsure({ answers: {}, unavailable: true }, "broken")).toBe(true);
    expect(unsure(undefined, "broken")).toBe(true);
  });
});
