import { describe, it, expect } from "vitest";
import { assertMatchesSchema, matchesSchema, isFieldType } from "./declared-schema.js";

describe("assertMatchesSchema", () => {
  it("accepts a payload matching a flat schema", () => {
    expect(() =>
      assertMatchesSchema({ action: "opened", number: 12 }, { action: "string", number: "number" }),
    ).not.toThrow();
  });

  it("allows extra keys not in the schema", () => {
    expect(() =>
      assertMatchesSchema({ action: "opened", extra: true }, { action: "string" }),
    ).not.toThrow();
  });

  it("rejects a missing required key with a path", () => {
    expect(() => assertMatchesSchema({}, { action: "string" })).toThrow(/required key "action" missing/);
  });

  it("rejects a wrong scalar type", () => {
    expect(() => assertMatchesSchema({ number: "x" }, { number: "number" })).toThrow(
      /key "number" expected number, got string/,
    );
  });

  it("validates nested objects and reports nested path", () => {
    const declared = { issue: { number: "number" }, comment: { body: "string" } };
    expect(() =>
      assertMatchesSchema({ issue: { number: 7 }, comment: { body: "hi" } }, declared),
    ).not.toThrow();
    expect(() => assertMatchesSchema({ issue: { number: "7" }, comment: { body: "hi" } }, declared)).toThrow(
      /key "issue.number" expected number, got string/,
    );
  });

  it("treats `secret` leaf as a string", () => {
    expect(() => assertMatchesSchema({ token: "abc" }, { token: "secret" })).not.toThrow();
    expect(() => assertMatchesSchema({ token: 1 }, { token: "secret" })).toThrow(
      /key "token" expected string, got number/,
    );
  });

  it("distinguishes arrays and null from object", () => {
    expect(() => assertMatchesSchema({ items: [] }, { items: "array" })).not.toThrow();
    expect(() => assertMatchesSchema({ items: [] }, { items: "object" })).toThrow(
      /key "items" expected object, got array/,
    );
    expect(() => assertMatchesSchema({ obj: null }, { obj: "object" })).toThrow(
      /key "obj" expected object, got null/,
    );
  });
});

describe("matchesSchema", () => {
  it("returns ok on match", () => {
    expect(matchesSchema({ a: "x" }, { a: "string" })).toEqual({ ok: true });
  });
  it("returns error on mismatch", () => {
    const r = matchesSchema({}, { a: "string" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/required key "a" missing/);
  });
});

describe("isFieldType", () => {
  it("accepts known types and rejects others", () => {
    expect(isFieldType("string")).toBe(true);
    expect(isFieldType("secret")).toBe(true);
    expect(isFieldType("datetime")).toBe(false);
    expect(isFieldType(3)).toBe(false);
  });
});
