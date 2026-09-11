import { describe, expect, it, vi } from "vitest";
import { experimentIdleTimeoutMs } from "./tools.js";
import type { ToolExecutionContext } from "../types.js";

function ctx(deadlineAt?: string): ToolExecutionContext {
  return {
    config: {},
    meta: deadlineAt ? { experimentDeadlineAt: deadlineAt } : {},
  };
}

describe("experimentIdleTimeoutMs", () => {
  const now = Date.parse("2026-08-01T00:00:00.000Z");

  it("returns undefined when experiment deadline meta is absent", () => {
    vi.setSystemTime(now);
    expect(experimentIdleTimeoutMs(ctx())).toBeUndefined();
  });

  it("returns undefined when experiment deadline meta is unparseable", () => {
    vi.setSystemTime(now);
    expect(experimentIdleTimeoutMs(ctx("not-a-date"))).toBeUndefined();
  });

  it("floors near deadlines to 30 minutes", () => {
    vi.setSystemTime(now);
    expect(experimentIdleTimeoutMs(ctx(new Date(now + 5 * 60_000).toISOString()))).toBe(30 * 60_000);
  });

  it("caps far deadlines to 3 hours", () => {
    vi.setSystemTime(now);
    expect(experimentIdleTimeoutMs(ctx(new Date(now + 10 * 60 * 60_000).toISOString()))).toBe(3 * 60 * 60_000);
  });

  it("uses deadline plus 20 minutes for mid-range deadlines", () => {
    vi.setSystemTime(now);
    expect(experimentIdleTimeoutMs(ctx(new Date(now + 60 * 60_000).toISOString()))).toBe(80 * 60_000);
  });
});
