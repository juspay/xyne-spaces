import { describe, it, expect } from "vitest";
import {
  parseAgentPrivacy,
  isAgentInvocableBy,
  normalizeAgentPrivacy,
} from "./agent-privacy.js";

describe("parseAgentPrivacy", () => {
  it("defaults to everyone for absent/empty/legacy config", () => {
    for (const c of [undefined, null, {}, { privacy: null }, { privacy: "public" }, { privacy: {} }]) {
      expect(parseAgentPrivacy(c as Record<string, unknown>)).toEqual({ mode: "everyone", whitelist: [] });
    }
  });

  it("reads a well-formed whitelist and drops non-string ids", () => {
    expect(parseAgentPrivacy({ privacy: { mode: "whitelist", whitelist: ["u1", "u2", 3, "", null] } as unknown })).toEqual({
      mode: "whitelist",
      whitelist: ["u1", "u2"],
    });
  });

  it("treats mode:whitelist with no list as an empty whitelist (locked), not everyone", () => {
    expect(parseAgentPrivacy({ privacy: { mode: "whitelist" } as unknown })).toEqual({ mode: "whitelist", whitelist: [] });
  });
});

describe("isAgentInvocableBy", () => {
  it("allows anyone when mode is everyone (incl. anonymous)", () => {
    expect(isAgentInvocableBy({}, "u1")).toBe(true);
    expect(isAgentInvocableBy({}, undefined)).toBe(true);
    expect(isAgentInvocableBy({ privacy: { mode: "everyone" } as unknown }, "u1")).toBe(true);
  });

  it("allows only listed users under whitelist", () => {
    const cfg = { privacy: { mode: "whitelist", whitelist: ["alice", "bob", "carol"] } as unknown };
    expect(isAgentInvocableBy(cfg, "alice")).toBe(true);
    expect(isAgentInvocableBy(cfg, "carol")).toBe(true);
    expect(isAgentInvocableBy(cfg, "dave")).toBe(false);
  });

  it("does NOT implicitly allow an owner/admin who isn't listed (strict list)", () => {
    // The owner must add themselves; the whitelist is the exact allowed set.
    const cfg = { privacy: { mode: "whitelist", whitelist: ["alice"] } as unknown };
    expect(isAgentInvocableBy(cfg, "the-owner-not-in-list")).toBe(false);
  });

  it("denies everyone (incl. anonymous) when the whitelist is empty", () => {
    const cfg = { privacy: { mode: "whitelist", whitelist: [] } as unknown };
    expect(isAgentInvocableBy(cfg, "alice")).toBe(false);
    expect(isAgentInvocableBy(cfg, undefined)).toBe(false);
  });

  it("denies a null/empty caller under whitelist", () => {
    const cfg = { privacy: { mode: "whitelist", whitelist: ["alice"] } as unknown };
    expect(isAgentInvocableBy(cfg, "")).toBe(false);
    expect(isAgentInvocableBy(cfg, null)).toBe(false);
  });

  it("fails OPEN (everyone) on a malformed privacy block rather than locking the agent", () => {
    expect(isAgentInvocableBy({ privacy: "whitelist" }, "anyone")).toBe(true);
    expect(isAgentInvocableBy({ privacy: { mode: "wat" } as unknown }, "anyone")).toBe(true);
  });
});

describe("normalizeAgentPrivacy", () => {
  it("canonicalizes everyone and clears the list", () => {
    expect(normalizeAgentPrivacy({ mode: "everyone", whitelist: ["x"] })).toEqual({ mode: "everyone", whitelist: [] });
  });

  it("dedupes and cleans a whitelist", () => {
    expect(normalizeAgentPrivacy({ mode: "whitelist", whitelist: ["a", "a", "b", "", 5] })).toEqual({
      mode: "whitelist",
      whitelist: ["a", "b"],
    });
  });

  it("preserves an intentionally-empty whitelist (locked agent)", () => {
    expect(normalizeAgentPrivacy({ mode: "whitelist", whitelist: [] })).toEqual({ mode: "whitelist", whitelist: [] });
  });

  it("returns undefined for junk (caller leaves config untouched)", () => {
    expect(normalizeAgentPrivacy(null)).toBeUndefined();
    expect(normalizeAgentPrivacy({ mode: "nope" })).toBeUndefined();
  });

  it("round-trips through parse+isInvocable", () => {
    const p = normalizeAgentPrivacy({ mode: "whitelist", whitelist: ["u1"] });
    expect(isAgentInvocableBy({ privacy: p as unknown }, "u1")).toBe(true);
    expect(isAgentInvocableBy({ privacy: p as unknown }, "u2")).toBe(false);
  });
});
