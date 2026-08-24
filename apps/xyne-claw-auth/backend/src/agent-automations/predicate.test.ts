import { describe, it, expect } from "vitest";
import { matchesPredicate } from "./predicate.js";

describe("matchesPredicate", () => {
  const body = { action: "created", issue: { number: 123 }, comment: { body: "hi" } };

  it("matches when empty/undefined predicate (no scoping)", () => {
    expect(matchesPredicate(body, undefined)).toBe(true);
    expect(matchesPredicate(body, null)).toBe(true);
    expect(matchesPredicate(body, {})).toBe(true);
  });

  it("matches a nested dot-path equality", () => {
    expect(matchesPredicate(body, { "issue.number": 123 })).toBe(true);
  });

  it("fails when the scoped value differs", () => {
    expect(matchesPredicate(body, { "issue.number": 999 })).toBe(false);
  });

  it("ANDs multiple conditions", () => {
    expect(matchesPredicate(body, { "issue.number": 123, action: "created" })).toBe(true);
    expect(matchesPredicate(body, { "issue.number": 123, action: "edited" })).toBe(false);
  });

  it("fails safely on a missing path", () => {
    expect(matchesPredicate(body, { "pull_request.id": 5 })).toBe(false);
  });
});
