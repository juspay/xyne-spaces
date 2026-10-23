import { describe, expect, it } from "vitest";
import { parseMeetUrl } from "../src/meetUrl.js";

describe("parseMeetUrl", () => {
  it("normalises Meet links", () => {
    expect(parseMeetUrl("https://meet.google.com/ABC-defg-hij?authuser=1")).toEqual({
      code: "abc-defg-hij",
      url: "https://meet.google.com/abc-defg-hij",
    });
    expect(parseMeetUrl("  meet.google.com/abc-defg-hij/ ")?.url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("rejects anything that isn't a meeting code", () => {
    expect(parseMeetUrl("https://meet.google.com/landing")).toBeNull();
    expect(parseMeetUrl("https://zoom.us/j/123")).toBeNull();
    expect(parseMeetUrl("https://evil.com/meet.google.com/abc-defg-hij")).toBeNull();
  });
});
