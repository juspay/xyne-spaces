import { describe, expect, it } from "vitest";
import { prepareSlackResultText, truncateSlackText } from "./mrkdwn.js";
import { SLACK_TEXT_LIMIT, TRUNCATED_SUFFIX } from "./const.js";

describe("Slack result text preparation", () => {
  it("converts markdown to mrkdwn via slackify (headings bold, links slack-style)", () => {
    const text = prepareSlackResultText("## Answer\n**yes** [source](https://example.com)");
    expect(text).toContain("*Answer*");
    expect(text).toContain("<https://example.com|source>");
    expect(text).not.toContain("##");
  });

  it("leaves short plain text untouched apart from trailing whitespace", () => {
    expect(prepareSlackResultText("plain words").trim()).toBe("plain words");
  });
});

describe("truncateSlackText", () => {
  it("returns short text unchanged", () => {
    expect(truncateSlackText("hello", 10)).toBe("hello");
  });

  it("truncates overflow to the limit with the suffix", () => {
    const result = truncateSlackText("x".repeat(SLACK_TEXT_LIMIT + 5));
    expect(result.length).toBe(SLACK_TEXT_LIMIT);
    expect(result.endsWith(TRUNCATED_SUFFIX)).toBe(true);
  });
});
