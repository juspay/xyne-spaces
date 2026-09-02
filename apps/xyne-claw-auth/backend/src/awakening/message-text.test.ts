import { describe, expect, it } from "vitest";
import { messageToText, threadTitleFrom } from "./message-text.js";

describe("messageToText", () => {
  it("unwraps the editor's paragraph markup", () => {
    expect(messageToText('<p class="m-0 leading-6">hey ask ai, can you help?</p>')).toBe(
      "hey ask ai, can you help?",
    );
  });

  it("keeps a trailing question mark reachable for question detection", () => {
    const text = messageToText('<p class="m-0 leading-6">is the deploy done?</p>');
    expect(/\?\s*$/.test(text)).toBe(true);
  });

  it("separates consecutive paragraphs with a newline, not a join", () => {
    expect(messageToText("<p>first line</p><p>second line</p>")).toBe("first line\nsecond line");
  });

  it("drops empty paragraphs instead of leaving blank runs", () => {
    expect(messageToText("<p>only this</p><p></p>")).toBe("only this");
  });

  it("renders <br> as a line break", () => {
    expect(messageToText("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("renders list items as dashes", () => {
    expect(messageToText("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
  });

  it("keeps a user mention as copy-pasteable shorthand with the id", () => {
    const html =
      '<span data-mention="" data-mention-type="user" data-user-id="u_123" data-username="Arjun Rao" class="chat-input-mention">@Arjun Rao</span> please look';
    expect(messageToText(html)).toBe("@Arjun Rao[u_123] please look");
  });

  it("preserves the mentioned user id so self-mention detection still works", () => {
    const html =
      '<p><span data-mention="" data-mention-type="user" data-user-id="bot_9" data-username="Ask AI">@Ask AI</span> ping</p>';
    expect(messageToText(html)).toContain("bot_9");
  });

  it("renders a group mention in group shorthand", () => {
    const html =
      '<span data-mention="" data-mention-type="group" data-group-id="g1" data-group-name="Oncall" data-group-alias="oncall">@oncall</span>';
    expect(messageToText(html)).toBe("@oncall[group:g1:Oncall]");
  });

  it("renders @channel and @here specials", () => {
    const html =
      '<span data-mention="" data-mention-type="channel" class="chat-input-special-mention">@channel</span> heads up';
    expect(messageToText(html)).toBe("@channel heads up");
  });

  it("substitutes custom emoji images with their alt text", () => {
    expect(messageToText('nice <img src="x.png" alt=":shipit:"> work')).toBe("nice :shipit: work");
  });

  it("decodes named and numeric entities", () => {
    expect(messageToText("<p>a &amp; b &lt;c&gt; &#8212; &#x2014; d&nbsp;e</p>")).toBe(
      "a & b <c> — — d e",
    );
  });

  it("strips script and style bodies rather than printing them", () => {
    expect(messageToText("<p>hi</p><script>alert(1)</script><style>.a{color:red}</style>")).toBe("hi");
  });

  it("passes plain text through untouched", () => {
    expect(messageToText("just a plain message")).toBe("just a plain message");
  });

  it("returns empty string for null, undefined and blank", () => {
    expect(messageToText(null)).toBe("");
    expect(messageToText(undefined)).toBe("");
    expect(messageToText("   ")).toBe("");
  });

  it("collapses runaway blank lines", () => {
    expect(messageToText("<p>a</p><p></p><p></p><p></p><p>b</p>")).toBe("a\nb");
  });

  it("never throws on malformed markup", () => {
    expect(() => messageToText("<p>unclosed <span data-mention-type=\"user\"")).not.toThrow();
  });

  it("shrinks the string it is given rather than inflating context", () => {
    const html = '<p class="m-0 leading-6">short</p>';
    expect(messageToText(html).length).toBeLessThan(html.length);
  });
});

describe("threadTitleFrom", () => {
  const block = [
    ":::initialMessage",
    "messageId: m1",
    "conversationId: c1",
    "senderId: u1",
    'content: <p class="m-0 leading-6">5xx spike on /txn/authorize</p>',
    "msgType: USER",
    "createdAt: 1786030327975",
    ":::",
  ].join("\n");

  it("reads the content field instead of the block marker", () => {
    expect(threadTitleFrom(block)).toBe("5xx spike on /txn/authorize");
  });

  it("does not title every thread ':::initialMessage'", () => {
    expect(threadTitleFrom(block)).not.toContain("initialMessage");
  });

  it("stops at the next metadata key on a multi-line content value", () => {
    const multi = [
      ":::initialMessage",
      "content: first line",
      "second line of the same message",
      "msgType: USER",
      ":::",
    ].join("\n");
    expect(threadTitleFrom(multi)).toBe("first line");
  });

  it("falls back to plain text when there is no metadata block", () => {
    expect(threadTitleFrom("just a title")).toBe("just a title");
  });

  it("truncates long titles with an ellipsis", () => {
    const long = `content: ${"x".repeat(200)}`;
    const title = threadTitleFrom(`:::initialMessage\n${long}\nmsgType: USER\n:::`);
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("reports untitled for empty, null and contentless blocks", () => {
    expect(threadTitleFrom(null)).toBe("(untitled thread)");
    expect(threadTitleFrom("")).toBe("(untitled thread)");
    expect(threadTitleFrom(":::initialMessage\nmsgType: USER\n:::")).toBe("(untitled thread)");
  });
});
