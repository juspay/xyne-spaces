import { beforeEach, describe, expect, it, vi } from "vitest";

const xorMock = vi.fn();
vi.mock("../src/xor.js", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), xor: (req: unknown) => xorMock(req) }));

const { buildXorDecideTool, decideStats, pickReviewSamples, quotaCheck, resetXorQuotas } = await import("../src/xor-decide-tool.js");
const { takeDebug } = await import("../src/citations.js");
const { runWithSubagentMcpId } = await import("../src/subagent-mcp-context.js");
const { visualStats } = await import("../src/ui-tester/tools.js");
type Exec = (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }>;

const QUESTIONS = [{ id: "failure", question: "Real failure?", type: "yesno" }];
const ITEMS = [{ id: "a", text: "ERROR db" }, { id: "b", text: "INFO ok" }];

beforeEach(() => {
  xorMock.mockReset();
  resetXorQuotas();
});

describe("xor quota", () => {
  it("allows items up to the hourly limit and then blocks until the hour rolls over", () => {
    const t = 1_000_000;
    expect(quotaCheck("sa1", 60, 100, t)).toEqual({ ok: true });
    expect(quotaCheck("sa1", 50, 100, t + 1000)).toEqual({ ok: false, used: 60 });
    expect(quotaCheck("sa2", 50, 100, t + 1000)).toEqual({ ok: true });
    expect(quotaCheck("sa1", 50, 100, t + 3_600_001)).toEqual({ ok: true });
  });

  it("makes xor-decide refuse with a clear message inside a subagent over its quota", async () => {
    xorMock.mockResolvedValue({ failure: { type: "noul", noul: 0.9 } });
    const tool = buildXorDecideTool({}, { itemsPerHour: { sa1: 3 } });
    const exec = tool.execute as unknown as Exec;
    const first = await runWithSubagentMcpId("sa1", () => exec("c1", { items: ITEMS, questions: QUESTIONS }));
    expect(first.content[0]!.text).toMatch(/^xor-decide: 2 item/);
    const second = await runWithSubagentMcpId("sa1", () => exec("c2", { items: ITEMS, questions: QUESTIONS }));
    expect(second.content[0]!.text).toMatch(/quota is 3 items per hour and 2 were used/);
    expect(takeDebug("c2")).toEqual({ xor: { quotaBlocked: true, items: 2 } });
    expect(xorMock).toHaveBeenCalledTimes(2);
  });
});

describe("xor-decide ops stats", () => {
  it("records compact stats for every call", async () => {
    xorMock.mockImplementation(async (req: { state: string }) => ({ failure: { type: "noul", noul: req.state.includes("ERROR") ? 0.97 : 0.55 } }));
    await (buildXorDecideTool({}).execute as unknown as Exec)("c3", { items: ITEMS, questions: QUESTIONS });
    const d = takeDebug("c3") as { xor: Record<string, number> };
    expect(d.xor).toMatchObject({ items: 2, questions: 1, answers: 2, unsure: 1, unavailable: 0, cached: 0 });
  });

  it("samples confident answers for human review, never unsure ones", () => {
    const result = {
      items: [
        { id: "a", answers: { failure: { value: true, confidence: 0.94, unsure: false } } },
        { id: "b", answers: { failure: { value: false, confidence: 0.1, unsure: true } } },
      ],
      summary: [],
      unavailable: 0,
      cached: 0,
    };
    const picked = pickReviewSamples(ITEMS, QUESTIONS as never, result as never, 1, () => 0);
    expect(picked).toEqual([{ item: "ERROR db", questionId: "failure", question: "Real failure?", value: true, confidence: 0.94 }]);
    expect(pickReviewSamples(ITEMS, QUESTIONS as never, result as never, 0.2, () => 0.5)).toEqual([]);
    expect(decideStats(QUESTIONS as never, result as never, 12)).toMatchObject({ items: 2, answers: 2, ms: 12 });
  });

  it("summarises ui-tester verdicts the same way", () => {
    const stats = visualStats([
      { id: "v1", verdict: "pass", findings: [], visual: { cut_off: { choice: "no", confidence: 0.95 }, content: { choice: "data", confidence: 0.4 } } },
      { id: "v2", verdict: "unsure", findings: [{ severity: "unsure", source: "visual", message: "visual check unavailable (xor returned nothing)" }], visual: {} },
    ]);
    expect(stats).toEqual({ items: 1, answers: 2, unsure: 1, unavailable: 1, cached: 0, failedExpect: 0 });
  });
});
