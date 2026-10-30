import { describe, expect, it } from "vitest";
import { parseMeetingUrl } from "../src/meetingUrl.js";

describe("parseMeetingUrl", () => {
  it("normalises Meet links", () => {
    expect(parseMeetingUrl("https://meet.google.com/ABC-defg-hij?authuser=1")).toEqual({
      platform: "google_meet",
      code: "abc-defg-hij",
      url: "https://meet.google.com/abc-defg-hij",
    });
    expect(parseMeetingUrl("  meet.google.com/abc-defg-hij/ ")?.url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("normalises Teams links", () => {
    const classic = parseMeetingUrl(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmFrZQ%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d&anon=true",
    );
    expect(classic?.platform).toBe("teams");
    expect(classic?.url).toBe(
      "https://teams.microsoft.com/l/meetup-join/19%3Ameeting_ZmFrZQ%40thread.v2/0?context=%7B%22Tid%22%3A%22t%22%7D",
    );
    expect(parseMeetingUrl("https://teams.live.com/meet/9876543210?p=abc&x=1")).toEqual({
      platform: "teams",
      code: "9876543210",
      url: "https://teams.live.com/meet/9876543210?p=abc",
    });
  });

  it("rejects anything else", () => {
    expect(parseMeetingUrl("https://meet.google.com/landing")).toBeNull();
    expect(parseMeetingUrl("https://zoom.us/j/123")).toBeNull();
    expect(parseMeetingUrl("https://evil.com/meet.google.com/abc-defg-hij")).toBeNull();
    expect(parseMeetingUrl("https://teams.microsoft.com/")).toBeNull();
  });
});
