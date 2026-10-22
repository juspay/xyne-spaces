import { describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { advanceLoop, validateLoopSpec } = await import("./engine.js");
type Spec = Parameters<typeof advanceLoop<{ n: number }, Record<string, never>, string>>[0];

const order: string[] = [];
const spec: Spec = {
  id: "t",
  policy: {},
  nodes: {
    pass: { kind: "pass", run: async () => { order.push("pass"); return { output: "again" }; } },
    check: { kind: "checker", run: () => new Promise((resolve) => setTimeout(() => { order.push("check"); resolve(); }, 5)) },
    decide: { kind: "decide", run: async (ledger) => ({ ledger: { n: ledger.n + 1 } }) },
    end: { kind: "end", run: async () => ({ output: "stop" }) },
  },
  edges: [
    { from: "pass", on: "result", to: "check", label: "finished" },
    { from: "check", on: "done", to: "decide", label: "checked" },
    { from: "decide", on: "done", to: "end", label: "enough", when: (ledger) => ledger.n >= 3 },
    { from: "decide", on: "done", to: "pass", label: "more" },
  ],
};

describe("advanceLoop", () => {
  it("chains through checker and decide nodes and stops at the next pass", async () => {
    order.length = 0;
    const step = await advanceLoop(spec, { from: "pass", on: "result", ledger: { n: 0 }, ctx: {} });
    expect(step).toEqual({ path: ["check", "decide", "pass"], labels: ["finished", "checked", "more"], stoppedAt: "pass", ledger: { n: 1 }, output: "again" });
    expect(order).toEqual(["pass"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["pass", "check"]);
  });

  it("follows the first matching conditional edge", async () => {
    const step = await advanceLoop(spec, { from: "pass", on: "result", ledger: { n: 2 }, ctx: {} });
    expect(step.stoppedAt).toBe("end");
    expect(step.output).toBe("stop");
  });

  it("waits when no edge matches the event", async () => {
    const step = await advanceLoop(spec, { from: "end", on: "result", ledger: { n: 0 }, ctx: {} });
    expect(step).toEqual({ path: [], labels: [], stoppedAt: null, ledger: { n: 0 } });
  });

  it("does not let a failing background checker break the loop", async () => {
    const failing: Spec = { ...spec, nodes: { ...spec.nodes, check: { kind: "checker", run: async () => { throw new Error("boom"); } } } };
    const step = await advanceLoop(failing, { from: "pass", on: "result", ledger: { n: 0 }, ctx: {} });
    expect(step.stoppedAt).toBe("pass");
  });
});

describe("validateLoopSpec", () => {
  it("accepts a well-formed spec and reports dangling edges", () => {
    expect(validateLoopSpec(spec as never)).toEqual([]);
    expect(validateLoopSpec({ ...spec, edges: [...spec.edges, { from: "pass", on: "x", to: "nowhere", label: "bad" }] } as never)).toEqual([
      'edge "bad" targets unknown node nowhere',
    ]);
  });
});
