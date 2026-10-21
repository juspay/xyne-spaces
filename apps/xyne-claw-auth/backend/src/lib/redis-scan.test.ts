import { describe, expect, it } from "vitest";
import { scanKeys, type ScanClient } from "./redis-scan.js";

function fakeRedis(pages: string[][]): ScanClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async scan(cursor, _match, pattern) {
      calls.push(`${cursor}:${pattern}`);
      const i = Number(cursor);
      const next = i + 1 < pages.length ? String(i + 1) : "0";
      return [next, pages[i] ?? []];
    },
  };
}

describe("scanKeys", () => {
  it("collects keys across every SCAN page until the cursor returns to 0", async () => {
    const redis = fakeRedis([["cc-approval:a"], [], ["cc-approval:b", "cc-approval:c"]]);
    expect((await scanKeys(redis, "cc-approval:*")).sort()).toEqual(["cc-approval:a", "cc-approval:b", "cc-approval:c"]);
    expect(redis.calls).toEqual(["0:cc-approval:*", "1:cc-approval:*", "2:cc-approval:*"]);
  });

  it("drops the duplicates SCAN is allowed to return", async () => {
    expect(await scanKeys(fakeRedis([["k1", "k2"], ["k2"]]), "k*")).toEqual(["k1", "k2"]);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await scanKeys(fakeRedis([[]]), "none:*")).toEqual([]);
  });
});
