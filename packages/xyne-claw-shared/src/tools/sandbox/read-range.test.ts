import { describe, expect, it } from "vitest";
import { hasRange, sliceLines } from "./read-range.js";

const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");

describe("sliceLines", () => {
  it("returns the requested window with its position in the file", () => {
    expect(sliceLines(text, 3, 2)).toEqual({ content: "line 3\nline 4", startLine: 3, endLine: 4, totalLines: 10 });
  });

  it("reads to the end when only an offset is given", () => {
    const r = sliceLines(text, 9, undefined);
    expect(r.content).toBe("line 9\nline 10");
    expect(r.endLine).toBe(10);
  });

  it("reads from the top when only a limit is given", () => {
    expect(sliceLines(text, undefined, 2).content).toBe("line 1\nline 2");
  });

  it("returns an empty window past the end instead of failing", () => {
    expect(sliceLines(text, 50, 5)).toEqual({ content: "", startLine: 50, endLine: 49, totalLines: 10 });
  });

  it("accepts numeric strings and ignores invalid values", () => {
    expect(sliceLines(text, "2", "1").content).toBe("line 2");
    expect(sliceLines(text, 0, -3).content).toBe(text);
  });
});

describe("hasRange", () => {
  it("is true only when a usable offset or limit was passed", () => {
    expect(hasRange(undefined, undefined)).toBe(false);
    expect(hasRange(0, "x")).toBe(false);
    expect(hasRange(5, undefined)).toBe(true);
    expect(hasRange(undefined, 20)).toBe(true);
  });
});
