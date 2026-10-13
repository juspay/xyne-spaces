import { describe, expect, it } from "vitest";
import { groupByUser } from "./batching.js";

describe("groupByUser", () => {
  it("puts every due loop for one user into a single batch, keeping order", () => {
    const batches = groupByUser([
      { userId: "u1", loopId: "l1" },
      { userId: "u2", loopId: "l2" },
      { userId: "u1", loopId: "l3" },
    ]);
    expect(batches.map((b) => b.map((c) => c.loopId))).toEqual([["l1", "l3"], ["l2"]]);
  });
});
