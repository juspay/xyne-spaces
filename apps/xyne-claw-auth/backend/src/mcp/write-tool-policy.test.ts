import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("./static-adapters.js", () => ({ STATIC_ADAPTERS: {} }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { isWriteToolUnderPolicy, effectiveWriteTools } = await import("./connector-definitions.js");

const ALL = ["read_a", "read_b", "write_x", "write_y"];

describe("isWriteToolUnderPolicy", () => {
  it("undefined policy → never a write tool (static-adapter fallback path)", () => {
    expect(isWriteToolUnderPolicy(undefined, "write_x")).toBe(false);
  });

  it("allowlist → only listed tools gated", () => {
    const p = { mode: "allowlist" as const, tools: ["write_x"] };
    expect(isWriteToolUnderPolicy(p, "write_x")).toBe(true);
    expect(isWriteToolUnderPolicy(p, "read_a")).toBe(false);
  });

  it("denylist → everything except listed is gated", () => {
    const p = { mode: "denylist" as const, tools: ["read_a"] };
    expect(isWriteToolUnderPolicy(p, "read_a")).toBe(false);
    expect(isWriteToolUnderPolicy(p, "write_x")).toBe(true);
  });

  it("allAsk → every tool is gated", () => {
    const p = { mode: "allAsk" as const, tools: [] };
    expect(isWriteToolUnderPolicy(p, "read_a")).toBe(true);
    expect(isWriteToolUnderPolicy(p, "write_x")).toBe(true);
  });

  it("allowAll → no tool is gated", () => {
    const p = { mode: "allowAll" as const, tools: [] };
    expect(isWriteToolUnderPolicy(p, "write_x")).toBe(false);
  });
});

describe("effectiveWriteTools", () => {
  it("allowlist returns the listed tools", () => {
    expect(effectiveWriteTools({ mode: "allowlist", tools: ["write_x"] }, ALL)).toEqual(["write_x"]);
  });

  it("denylist returns all tools minus the listed ones", () => {
    expect(effectiveWriteTools({ mode: "denylist", tools: ["read_a", "read_b"] }, ALL)).toEqual([
      "write_x",
      "write_y",
    ]);
  });

  it("allAsk returns every tool", () => {
    expect(effectiveWriteTools({ mode: "allAsk", tools: [] }, ALL)).toEqual(ALL);
  });

  it("allowAll returns none", () => {
    expect(effectiveWriteTools({ mode: "allowAll", tools: [] }, ALL)).toEqual([]);
  });
});
