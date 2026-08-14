import { describe, expect, it } from "vitest";

import { formatDurationMs, isWallClockExceeded } from "./loopBudget.js";

describe("isWallClockExceeded", () => {
  const created = new Date("2026-08-14T10:00:00.000Z");
  const createdMs = created.getTime();

  it("is false before the budget elapses", () => {
    expect(isWallClockExceeded(created, 30 * 60_000, createdMs + 29 * 60_000)).toBe(false);
  });

  it("is true exactly at the budget boundary (>=)", () => {
    expect(isWallClockExceeded(created, 30 * 60_000, createdMs + 30 * 60_000)).toBe(true);
  });

  it("is true after the budget elapses", () => {
    expect(isWallClockExceeded(created, 30 * 60_000, createdMs + 31 * 60_000)).toBe(true);
  });
});

describe("formatDurationMs", () => {
  it("prefers the largest whole unit", () => {
    expect(formatDurationMs(7_200_000)).toBe("2h");
    expect(formatDurationMs(1_800_000)).toBe("30m");
    expect(formatDurationMs(45_000)).toBe("45s");
    expect(formatDurationMs(500)).toBe("500ms");
  });
});
