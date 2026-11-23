import { describe, it, expect, vi } from "vitest";
import { Prisma, type LlmModelPrice } from "@prisma/client";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../middleware/agent-acl.js", () => ({ isClawAdmin: vi.fn() }));
vi.mock("./metrics-sql.js", () => ({ runAnalytics: vi.fn() }));
vi.mock("./metrics-core.js", () => ({ parseTz: () => "UTC" }));

const {
  OTHER_KEY, dayList, foldSeries, parseLlmCallEvent, parsePriceInput, parseRange, pickPrice, priceCall, withCumulativeCost, zonedDayStart,
} = await import("./llm-usage.js");

const price = (over: Partial<LlmModelPrice>): LlmModelPrice => ({
  id: "p1", provider: "claude", model: "claude-x", serviceTier: "standard",
  inputPerMTok: new Prisma.Decimal(3), outputPerMTok: new Prisma.Decimal(15),
  cacheReadPerMTok: new Prisma.Decimal("0.3"), cacheWritePerMTok: new Prisma.Decimal("3.75"),
  effectiveFrom: new Date(0), updatedByUserId: null, createdAt: new Date(0), updatedAt: new Date(0), slabs: [], ...over,
});
const call = (over: Partial<Parameters<typeof priceCall>[1]> = {}) => ({
  provider: "claude", billing: "api_key", model: "claude-x", serviceTier: "standard", startedAt: new Date("2026-11-01T00:00:00Z"),
  input: 1_234, output: 567, cacheRead: 89_000, cacheWrite: 4_321, ...over,
});

describe("priceCall", () => {
  it("prices each token class exactly to 8 decimals", () => {
    // 1234*3 + 567*15 + 89000*0.3 + 4321*3.75 = 3702 + 8505 + 26700 + 16203.75 = 55110.75 µ$ → $0.05511075
    expect(priceCall([price({})], call()).costUsd?.toString()).toBe("0.05511075");
  });

  it.each([
    ["subscription is never priced", call({ billing: "subscription" }), null, null],
    ["unpriced API call stays NULL", call({ model: "other" }), null, null],
    ["unpriced platform call costs 0", call({ billing: "platform", provider: "spaces", model: "open-fast" }), "0", null],
  ])("%s", (_l, c, cost, priceId) => {
    const r = priceCall([price({})], c);
    expect(r.costUsd?.toString() ?? null).toBe(cost);
    expect(r.priceId).toBe(priceId);
  });

  it("uses the row in effect when the call started, then the served model", () => {
    const old = price({ id: "old", effectiveFrom: new Date("2026-01-01") });
    const next = price({ id: "next", effectiveFrom: new Date("2026-11-15") });
    expect(pickPrice([old, next], call())?.id).toBe("old");
    expect(pickPrice([old, next], call({ startedAt: new Date("2026-11-16") }))?.id).toBe("next");
    expect(pickPrice([price({ id: "served", model: "claude-x-2026" })], call({ servedModel: "claude-x-2026" }))?.id).toBe("served");
    expect(pickPrice([price({ serviceTier: "fast" })], call())).toBeUndefined();
  });

  it("prices the whole request at the highest slab its prompt is over", () => {
    const d = (v: string) => new Prisma.Decimal(v);
    const slab = (overPromptTokens: number, x: number) => ({
      overPromptTokens, inputPerMTok: String(x), outputPerMTok: String(5 * x), cacheReadPerMTok: String(x / 10), cacheWritePerMTok: String(1.25 * x),
    });
    const tiered = price({ inputPerMTok: d("0.1"), outputPerMTok: d("0.5"), cacheReadPerMTok: d("0.01"), cacheWritePerMTok: d("0.125"), slabs: [slab(200_000, 1), slab(100_000, 0.5)] });
    const at = (input: number) => priceCall([tiered], call({ input, cacheRead: 40_000, cacheWrite: 0, output: 1_000 }));
    // Prompt exactly 100,000: base. 60000*0.1 + 40000*0.01 + 1000*0.5 = 6900 µ$
    expect(at(60_000)).toEqual({ costUsd: d("0.0069"), priceId: "p1", slabOverPromptTokens: null });
    // 100,001: every token at the 100k slab. 60001*0.5 + 40000*0.05 + 1000*2.5 = 34500.5 µ$
    expect(at(60_001)).toEqual({ costUsd: d("0.0345005"), priceId: "p1", slabOverPromptTokens: 100_000 });
    expect(at(200_000).slabOverPromptTokens).toBe(200_000);
  });
});

describe("parseLlmCallEvent", () => {
  const ok = {
    id: "e1", purpose: "main", outcome: "ok", provider: "spaces", billing: "platform", model: "m", usageReported: true,
    input: 1, output: 2, cacheRead: 3, cacheWrite: 4, startedAt: "2026-11-19T10:00:00Z", durationMs: 5, toolNames: ["a", 7],
  };
  it("keeps a valid event and drops non-string tool names", () => {
    expect(parseLlmCallEvent(ok)).toMatchObject({ id: "e1", toolNames: ["a"] });
  });
  it.each([
    ["negative tokens", { input: -1 }],
    ["fractional tokens", { output: 1.5 }],
    ["unknown billing", { billing: "free" }],
    ["unknown outcome", { outcome: "maybe" }],
    ["bad timestamp", { startedAt: "yesterday" }],
    ["missing usageReported", { usageReported: undefined }],
  ])("rejects %s", (_l, over) => {
    expect(parseLlmCallEvent({ ...ok, ...over })).toBeNull();
  });
});

describe("ranges", () => {
  it("starts days at local midnight, including across DST", () => {
    expect(zonedDayStart("2026-11-19", "Asia/Kolkata").toISOString()).toBe("2026-11-18T18:30:00.000Z");
    expect(zonedDayStart("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedDayStart("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
  it("defaults to the last 30 days in the viewer's zone and validates bounds", () => {
    expect(parseRange({}, "Asia/Kolkata", new Date("2026-11-19T20:00:00Z"))).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(parseRange({ from: "2026-11-10", to: "2026-11-01" }, "UTC")).toEqual({ error: "from must be on or before to" });
    expect(dayList("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("foldSeries", () => {
  const p = (day: string, key: string, costUsd: number, inputTokens = 0) =>
    ({ day, key, costUsd, inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 1 });
  it("keeps the top keys by cost and sums the rest into Other per day", () => {
    const { keys, points } = foldSeries([p("d1", "a", 5), p("d1", "b", 1), p("d1", "c", 2), p("d2", "b", 1, 10), p("d2", "c", 0.5)], 1);
    expect(keys).toEqual(["a", OTHER_KEY]);
    expect(points).toEqual([{ ...p("d1", OTHER_KEY, 3), calls: 2 }, p("d1", "a", 5), { ...p("d2", OTHER_KEY, 1.5, 10), calls: 2 }]);
  });
});

describe("withCumulativeCost", () => {
  it("adds decimal costs without float drift and skips unpriced calls", () => {
    const out = withCumulativeCost([{ costUsd: 0.1 }, { costUsd: null }, { costUsd: 0.2 }]);
    expect(out.map((c) => c.cumulativeCostUsd)).toEqual([0.1, 0.1, 0.3]);
  });
});

describe("parsePriceInput", () => {
  it("defaults tier and rejects negative rates", () => {
    expect(parsePriceInput({ provider: "spaces", model: "m", inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0, cacheWritePerMTok: 0 })).toMatchObject({ serviceTier: "standard" });
    expect(parsePriceInput({ provider: "spaces", model: "m", inputPerMTok: -1, outputPerMTok: 2, cacheReadPerMTok: 0, cacheWritePerMTok: 0 })).toEqual({ error: "inputPerMTok must be a non-negative number" });
  });
  it("sorts slabs and rejects a repeated or fractional threshold", () => {
    const base = { provider: "claude", model: "m", inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 };
    const slab = (overPromptTokens: number) => ({ overPromptTokens, inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 });
    expect(parsePriceInput({ ...base, slabs: [slab(200_000), slab(100_000)] })).toMatchObject({ slabs: [{ overPromptTokens: 100_000 }, { overPromptTokens: 200_000 }] });
    expect(parsePriceInput({ ...base, slabs: [slab(100_000), slab(100_000)] })).toEqual({ error: "two slabs start over 100000 tokens" });
    expect(parsePriceInput({ ...base, slabs: [slab(1.5)] })).toMatchObject({ error: expect.stringContaining("overPromptTokens") });
  });
});
