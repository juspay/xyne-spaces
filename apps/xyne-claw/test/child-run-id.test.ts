/**
 * child-run-id.test.ts — the run id shared by a child run and the parent row
 * that spawned it. Both spawners mint it once and hand it down: the parent's
 * timeline and the child's header must agree, and deriving it twice off two
 * clocks does not.
 */
import { describe, it, expect } from "vitest";
import { childRunIdFor, runIdFor } from "../src/debug/keys.js";

describe("childRunIdFor", () => {
  it("is stable for the same inputs", () => {
    expect(childRunIdFor(1700000000000, "cards-doctor", "call_42")).toBe(
      childRunIdFor(1700000000000, "cards-doctor", "call_42"),
    );
  });

  it("separates two concurrent children of the same callee by tool call", () => {
    const a = childRunIdFor(1700000000000, "cards-doctor", "call_1");
    const b = childRunIdFor(1700000000000, "cards-doctor", "call_2");
    expect(a).not.toBe(b);
  });

  it("sanitizes both segments into a safe path/run token", () => {
    const id = childRunIdFor(1700000000000, "weird/slug name", "call:/../42");
    expect(id).toMatch(/^\d+-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/);
    expect(id).not.toContain("/");
    expect(id).not.toContain("..");
  });

  it("keeps the started-at prefix that orders runs newest-first", () => {
    expect(childRunIdFor(1700000000000, "x", "c")).toMatch(/^1700000000000-/);
  });

  it("does not collide with a top-level run id for the same session", () => {
    expect(childRunIdFor(1700000000000, "x", "c")).not.toBe(runIdFor(1700000000000, "x"));
  });
});
