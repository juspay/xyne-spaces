import { describe, it, expect } from "vitest";
import { parseFrontierItems, hasResolvableCitation, normalizeFocus } from "./experiment-text.js";

const TABLE_LIST = `go through all of this tables and explain its scope and use case

service_configuration
card_brand_routes
config_reference
merchant_gateway_account
tenant_config`;

describe("parseFrontierItems", () => {
  it("seeds one path per named item from a pasted list", () => {
    // The user's own enumeration is ground truth — this is what stops the run
    // exiting early by imagining a smaller scope.
    expect(parseFrontierItems(TABLE_LIST)).toEqual([
      "service_configuration",
      "card_brand_routes",
      "config_reference",
      "merchant_gateway_account",
      "tenant_config",
    ]);
  });

  it("ignores the prose line that introduces the list", () => {
    expect(parseFrontierItems(TABLE_LIST)).not.toContain("go through all of this tables and explain its scope and use case");
  });

  it("tolerates list punctuation and backticks", () => {
    expect(parseFrontierItems("- foo_a\n* foo_b\n1. foo_c\n`foo_d`")).toEqual([
      "foo_a", "foo_b", "foo_c", "foo_d",
    ]);
  });

  it("accepts a comma-separated list", () => {
    expect(parseFrontierItems("alpha_one, beta_two, gamma_three")).toEqual([
      "alpha_one", "beta_two", "gamma_three",
    ]);
  });

  it("dedupes case-insensitively so one path is not seeded twice", () => {
    expect(parseFrontierItems("foo_a\nFOO_A\nfoo_b\nfoo_c")).toEqual(["foo_a", "foo_b", "foo_c"]);
  });

  it("seeds nothing for prose focus — the run falls back to model enumeration", () => {
    expect(parseFrontierItems("understand how routing decides the gateway for a txn")).toEqual([]);
    expect(parseFrontierItems(null)).toEqual([]);
    expect(parseFrontierItems("")).toEqual([]);
  });

  it("needs at least 3 items before treating the text as a list", () => {
    // Two identifiers are more likely a phrase than an enumeration; guessing
    // wrong here would seed a frontier the user never asked for.
    expect(parseFrontierItems("foo_a\nfoo_b")).toEqual([]);
  });

  it("caps a runaway paste rather than seeding thousands of paths", () => {
    const huge = Array.from({ length: 500 }, (_, i) => `table_${i}`).join("\n");
    expect(parseFrontierItems(huge)).toHaveLength(200);
  });
});

describe("hasResolvableCitation", () => {
  it("accepts a file:line citation", () => {
    expect(hasResolvableCitation("Written by src/gateway/emi.ts:214 during eligibility")).toBe(true);
    expect(hasResolvableCitation("see app/Euler/Storage/Types/Foo.hs:88")).toBe(true);
  });

  it("rejects a close that only restates the name", () => {
    // The exact failure mode understanding mode is meant to prevent: the
    // identifier already implies the sentence, so this is not an explanation.
    expect(hasResolvableCitation("gateway_bank_emi_support stores which banks support EMI per gateway")).toBe(false);
  });

  it("rejects a bare filename or a bare line number", () => {
    expect(hasResolvableCitation("defined in emi.ts")).toBe(false);
    expect(hasResolvableCitation("around line 214")).toBe(false);
  });

  it("rejects a missing note", () => {
    expect(hasResolvableCitation(undefined)).toBe(false);
    expect(hasResolvableCitation(null)).toBe(false);
  });
});

describe("normalizeFocus — scope must never be dropped silently", () => {
  const tables = Array.from({ length: 57 }, (_, i) => `merchant_gateway_table_${i}`).join(" ");

  it("keeps a 57-item table list that the old 1000-char cap truncated", () => {
    // The real incident: 1158 chars of focus, cut at 1000, losing 11 tables
    // including the whole tenant_* group — and cutting mid-word ("rese").
    expect(tables.length).toBeGreaterThan(1000);
    const { focus, dropped } = normalizeFocus(tables);
    expect(dropped).toBeUndefined();
    expect(focus).toBe(tables);
  });

  it("reports the remainder instead of discarding it", () => {
    const huge = Array.from({ length: 1200 }, (_, i) => `table_${i}`).join(" ");
    const { focus, dropped } = normalizeFocus(huge);
    expect(dropped).toBeTruthy();
    // Nothing is lost: kept + dropped reconstitute the input.
    expect(`${focus} ${dropped}`).toBe(huge);
  });

  it("never splits an identifier in half", () => {
    const huge = Array.from({ length: 1200 }, (_, i) => `table_${i}`).join(" ");
    const { focus, dropped } = normalizeFocus(huge);
    // A half-name reads as a real name the agent will go hunting for.
    for (const token of `${focus}`.split(" ")) expect(token).toMatch(/^table_\d+$/);
    expect(dropped!.split(" ")[0]).toMatch(/^table_\d+$/);
  });

  it("strips a leading focus= and reports nothing dropped for short input", () => {
    expect(normalizeFocus("focus=explain the notification pipeline")).toEqual({
      focus: "explain the notification pipeline",
    });
    expect(normalizeFocus("   ")).toEqual({});
  });
});
