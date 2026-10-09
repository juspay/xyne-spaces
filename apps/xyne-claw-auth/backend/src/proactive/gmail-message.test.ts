import { describe, expect, it } from "vitest";
import type { GmailMessage } from "./gmail-api.js";
import { messageBodyText, parseAddressList, parseGmailMessage, stripQuoted } from "./gmail-message.js";

function message(overrides: Partial<GmailMessage> & { headers?: Record<string, string> } = {}): GmailMessage {
  const headers = overrides.headers ?? {};
  return {
    id: "m1",
    threadId: "t1",
    labelIds: overrides.labelIds ?? ["INBOX"],
    snippet: overrides.snippet ?? "Can you confirm by Friday?",
    internalDate: overrides.internalDate ?? String(Date.UTC(2026, 9, 9, 10)),
    payload: overrides.payload ?? {
      headers: Object.entries({
        From: "Asha Rao <asha@example.com>",
        To: "me@example.com",
        Subject: "Booking",
        ...headers,
      }).map(([name, value]) => ({ name, value })),
    },
  };
}

describe("parseAddressList", () => {
  it("splits on commas outside quotes and angle brackets", () => {
    expect(parseAddressList('"Rao, Asha" <ASHA@example.com>, bob@example.com, not-an-address')).toEqual([
      { key: "asha@example.com", name: "Rao, Asha" },
      { key: "bob@example.com", name: null },
    ]);
  });
});

describe("parseGmailMessage", () => {
  it("parses a direct inbound message", () => {
    const parsed = parseGmailMessage(message(), "Me@Example.com");
    expect(parsed).toMatchObject({
      from: { key: "asha@example.com", name: "Asha Rao" },
      subject: "Booking",
      fromUser: false,
      userRole: "to",
      noise: false,
      important: false,
    });
    expect(parsed.at.toISOString()).toBe("2026-10-09T10:00:00.000Z");
  });

  it("marks the user's own sent mail", () => {
    expect(parseGmailMessage(message({ labelIds: ["SENT"] }), "me@example.com").fromUser).toBe(true);
    expect(
      parseGmailMessage(message({ labelIds: ["DRAFT"], headers: { From: "me@example.com" } }), "me@example.com").fromUser,
    ).toBe(false);
    expect(
      parseGmailMessage(message({ headers: { From: "me@example.com", To: "asha@example.com" } }), "me@example.com").fromUser,
    ).toBe(true);
  });

  it("treats promotions, bulk mail, auto-replies and no-reply senders as noise", () => {
    expect(parseGmailMessage(message({ headers: { "Auto-Submitted": "auto-replied" } }), "me@example.com").noise).toBe(true);
    expect(parseGmailMessage(message({ headers: { "Auto-Submitted": "no" } }), "me@example.com").noise).toBe(false);
    expect(parseGmailMessage(message({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }), "me@example.com").noise).toBe(true);
    expect(parseGmailMessage(message({ headers: { "List-Unsubscribe": "<mailto:x>" } }), "me@example.com").noise).toBe(true);
    expect(parseGmailMessage(message({ headers: { From: "no-reply@bank.example" } }), "me@example.com").noise).toBe(true);
  });

  it("keeps important updates and bulk mail Gmail marked important", () => {
    expect(parseGmailMessage(message({ labelIds: ["INBOX", "CATEGORY_UPDATES", "IMPORTANT"] }), "me@example.com").noise).toBe(false);
    expect(
      parseGmailMessage(message({ labelIds: ["INBOX", "IMPORTANT"], headers: { "List-Id": "team" } }), "me@example.com").noise,
    ).toBe(false);
  });

  it("knows when the user is only in Cc", () => {
    expect(
      parseGmailMessage(message({ headers: { To: "team@example.com", Cc: "me@example.com" } }), "me@example.com").userRole,
    ).toBe("cc");
  });
});

describe("message bodies", () => {
  it("drops quoted history from replies", () => {
    expect(stripQuoted("Sounds good.\n\nOn Mon, Oct 6, 2026 at 10:00 Asha wrote:\n> earlier")).toBe("Sounds good.");
    expect(stripQuoted("Line one\n> quoted\nLine two")).toBe("Line one\nLine two");
  });

  it("prefers text/plain and falls back to stripped html", () => {
    const encode = (s: string) => Buffer.from(s).toString("base64url");
    const plain = message({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: encode("Please confirm.") } },
          { mimeType: "text/html", body: { data: encode("<p>ignored</p>") } },
        ],
      },
    });
    expect(messageBodyText(plain)).toBe("Please confirm.");
    const html = message({ payload: { mimeType: "text/html", body: { data: encode("<p>Hi&nbsp;there</p><br>Thanks") } } });
    expect(messageBodyText(html)).toBe("Hi there\n\nThanks");
  });
});
