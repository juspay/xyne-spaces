import { describe, expect, it } from "vitest";
import { markdownToSlackMrkdwn, prepareSlackResultText, truncateSlackText } from "./slack-mrkdwn.js";

describe("Slack mrkdwn conversion", () => {
  it("converts headings, bold text and Markdown links", () => {
    expect(markdownToSlackMrkdwn("## Result\n**Done**: see [details](https://example.com/a)."))
      .toBe("Result\n*Done*: see <https://example.com/a|details>.");
  });

  it("leaves ordinary text and non-http parenthesized text alone", () => {
    expect(markdownToSlackMrkdwn("plain [label](relative/path) text"))
      .toBe("plain [label](relative/path) text");
  });

  it("truncates at 39,000 characters with the required suffix", () => {
    const result = prepareSlackResultText("x".repeat(40_000));
    expect(result).toHaveLength(39_000);
    expect(result.endsWith("… (truncated)")).toBe(true);
  });

  it("supports smaller explicit limits", () => {
    expect(truncateSlackText("abcdefghijk", 10)).toHaveLength(10);
  });
});

