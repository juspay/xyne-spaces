import { describe, it, expect } from "vitest";
import { normalizePlanTitle, filterToApprovedTitles } from "./session-context.js";

describe("normalizePlanTitle", () => {
  it("trims, collapses inner whitespace, and lowercases", () => {
    expect(normalizePlanTitle("  Search  #General \n")).toBe("search #general");
    expect(normalizePlanTitle("Summarize\tFindings")).toBe("summarize findings");
    expect(normalizePlanTitle("ALREADY normal")).toBe("already normal");
  });

  it("is stable across cosmetic differences so id-regeneration doesn't matter", () => {
    expect(normalizePlanTitle("Send  weekly  update")).toBe(
      normalizePlanTitle("send weekly update"),
    );
  });
});

describe("filterToApprovedTitles (deterministic reject filter)", () => {
  const todo = (id: string, title: string) => ({ id, title, status: "pending" as const });

  it("drops todos whose title is NOT in the approved set (rejected ones can't render)", () => {
    const approved = [normalizePlanTitle("Send weekly update"), normalizePlanTitle("Summarize")];
    const todos = [
      todo("a", "Send weekly update"),
      todo("b", "Delete the database"), // rejected — model re-added it
      todo("c", "Summarize"),
    ];
    const kept = filterToApprovedTitles(todos, approved);
    expect(kept.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("matches regardless of case/whitespace (Turn 2 regenerates ids, may rephrase spacing)", () => {
    const approved = [normalizePlanTitle("Search #general")];
    const kept = filterToApprovedTitles([todo("x", "  SEARCH   #General ")], approved);
    expect(kept.map((t) => t.id)).toEqual(["x"]);
  });

  it("returns the ORIGINAL list unchanged when the approved set is empty (auto mode, no approval)", () => {
    const todos = [todo("a", "anything"), todo("b", "else")];
    expect(filterToApprovedTitles(todos, [])).toBe(todos);
  });

  it("falls back to unfiltered when NOTHING matches (titles diverged) — never a blank card", () => {
    const approved = [normalizePlanTitle("Original step one")];
    const todos = [todo("a", "Completely different"), todo("b", "Also different")];
    // Zero matches → return original so the card isn't emptied.
    expect(filterToApprovedTitles(todos, approved)).toBe(todos);
  });

  it("keeps all when every todo is approved (approve-all / trivial)", () => {
    const approved = [normalizePlanTitle("one"), normalizePlanTitle("two")];
    const todos = [todo("a", "one"), todo("b", "two")];
    const kept = filterToApprovedTitles(todos, approved);
    expect(kept.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
