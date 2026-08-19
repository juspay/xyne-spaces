import { describe, expect, test } from "vitest";
import type { UserMemoryRecord } from "xyne-claw-shared";
import { BATCH_TOKEN_BUDGET, packRecordsIntoBatches } from "./userMemoryBatcher.js";

function records(count: number, chars = 1): UserMemoryRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `message-${i}`,
    type: "message" as const,
    ts: "2026-08-14T00:00:00.000Z",
    text: "x".repeat(chars),
  }));
}

describe("packRecordsIntoBatches", () => {
  test("packs up to 200 short records into one curator call", () => {
    const batches = packRecordsIntoBatches(records(200));
    expect(batches.map((batch) => batch.length)).toEqual([200]);
  });

  test("starts a new batch after the 200-record backstop", () => {
    const batches = packRecordsIntoBatches(records(201));
    expect(batches.map((batch) => batch.length)).toEqual([200, 1]);
  });

  test("the 80k-token text budget wins before the record backstop", () => {
    const batches = packRecordsIntoBatches(records(200, 2_000));
    const maxChars = BATCH_TOKEN_BUDGET * 4;
    expect(batches.length).toBe(2);
    expect(batches.flat()).toHaveLength(200);
    for (const batch of batches) {
      expect(batch.reduce((sum, record) => sum + record.text.length, 0)).toBeLessThanOrEqual(maxChars);
    }
  });
});
