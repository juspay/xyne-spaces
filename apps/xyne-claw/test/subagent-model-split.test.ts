import { describe, expect, it } from "vitest";
import { clampPercent, pickSubagentLitellmModel, splitBucket } from "../src/subagent-model-split.js";

const base = { fastModel: "glm-5.3-flash", standardModel: "private-large-spaces" };

describe("pickSubagentLitellmModel", () => {
  it("uses the fast model for everyone at 100%", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickSubagentLitellmModel({ ...base, key: `s${i}`, fastPercent: 100 })).toEqual({ model: "glm-5.3-flash", arm: "fast" });
    }
  });

  it("uses the standard model for everyone at 0%", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickSubagentLitellmModel({ ...base, key: `s${i}`, fastPercent: 0 }).arm).toBe("standard");
    }
  });

  it("is standard when the fast model is not configured separately", () => {
    expect(pickSubagentLitellmModel({ ...base, fastModel: "private-large-spaces", key: "s", fastPercent: 100 }).arm).toBe("standard");
  });

  it("keeps every subagent of one parent run on the same arm", () => {
    const first = pickSubagentLitellmModel({ ...base, key: "parent-run-1", fastPercent: 50 });
    for (let i = 0; i < 20; i++) {
      expect(pickSubagentLitellmModel({ ...base, key: "parent-run-1", fastPercent: 50 })).toEqual(first);
    }
  });

  it("splits parent runs roughly by the configured percentage", () => {
    const n = 4000;
    let fast = 0;
    for (let i = 0; i < n; i++) {
      if (pickSubagentLitellmModel({ ...base, key: `session-${i}`, fastPercent: 50 }).arm === "fast") fast++;
    }
    expect(fast / n).toBeGreaterThan(0.46);
    expect(fast / n).toBeLessThan(0.54);
  });

  it("falls back to a random draw when there is no parent session", () => {
    expect(pickSubagentLitellmModel({ ...base, key: undefined, fastPercent: 50, random: () => 0.1 }).arm).toBe("fast");
    expect(pickSubagentLitellmModel({ ...base, key: undefined, fastPercent: 50, random: () => 0.9 }).arm).toBe("standard");
  });

  it("buckets are stable and within 0-99", () => {
    expect(splitBucket("abc")).toBe(splitBucket("abc"));
    for (let i = 0; i < 200; i++) {
      const b = splitBucket(`k${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
});

describe("clampPercent", () => {
  it("defaults when unset, blank or not a number", () => {
    expect(clampPercent(undefined, 100)).toBe(100);
    expect(clampPercent("", 100)).toBe(100);
    expect(clampPercent("abc", 100)).toBe(100);
  });

  it("clamps to 0-100 and rounds", () => {
    expect(clampPercent("50", 100)).toBe(50);
    expect(clampPercent("-5", 100)).toBe(0);
    expect(clampPercent("250", 100)).toBe(100);
    expect(clampPercent("33.6", 100)).toBe(34);
  });
});
