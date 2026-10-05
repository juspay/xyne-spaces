import { describe, expect, it } from "vitest";
import { parseChatTitlePayload, sanitizeChatTitle } from "../src/chat-title.js";

describe("sanitizeChatTitle", () => {
  it("keeps clean titles", () => {
    expect(sanitizeChatTitle("Deploy pipeline failing on main")).toBe(
      "Deploy pipeline failing on main",
    );
    expect(sanitizeChatTitle('Title: "Webhook retry policy choice".')).toBe(
      "Webhook retry policy choice",
    );
    expect(sanitizeChatTitle("**Adding a Prisma model column**")).toBe(
      "Adding a Prisma model column",
    );
    expect(sanitizeChatTitle("Fixing Ravi's flaky login test")).toBe(
      "Fixing Ravi's flaky login test",
    );
    expect(sanitizeChatTitle("  \nSaludo informal en español\n  ")).toBe(
      "Saludo informal en español",
    );
  });

  it("rejects multi-line reasoning instead of keeping the last line", () => {
    expect(
      sanitizeChatTitle(
        "The user just said Heyyy, which is a greeting.\nSo a title could be\nCasual greeting exchange",
      ),
    ).toBeNull();
    expect(sanitizeChatTitle("Hola greeting\nSpanish greeting conversation")).toBeNull();
  });

  it("rejects titles longer than eight words", () => {
    expect(
      sanitizeChatTitle("Friendly greeting from the user with no specific request yet"),
    ).toBeNull();
    expect(sanitizeChatTitle("One two three four five six seven eight")).toBe(
      "One two three four five six seven eight",
    );
  });

  it("rejects candidates that still contain an inner double quote", () => {
    expect(sanitizeChatTitle('Maybe "Casual greeting" works')).toBeNull();
    expect(sanitizeChatTitle("Maybe “Casual greeting” works")).toBeNull();
  });

  it("rejects narration openers", () => {
    for (const bad of [
      "The user greets in Spanish",
      "This conversation is a greeting",
      "The subject is a greeting",
      "The topic is a greeting",
      "The title should be short",
      "This chat is casual",
      "Candidate: casual greeting",
      "Another candidate is greeting",
      "Sentence case greeting title",
      "Okay greeting title",
    ]) {
      expect(sanitizeChatTitle(bad), bad).toBeNull();
    }
  });

  it("still rejects structured artifacts and non-strings", () => {
    expect(sanitizeChatTitle("<tool_call>record_chat_title</tool_call>")).toBeNull();
    expect(sanitizeChatTitle(42)).toBeNull();
    expect(sanitizeChatTitle("   ")).toBeNull();
  });
});

describe("parseChatTitlePayload", () => {
  it("extracts titles from JSON and fenced JSON", () => {
    expect(parseChatTitlePayload({ title: "Webhook retry policy choice" })).toBe(
      "Webhook retry policy choice",
    );
    expect(parseChatTitlePayload('```json\n{"title":"Webhook retry policy choice"}\n```')).toBe(
      "Webhook retry policy choice",
    );
  });

  it("returns null for multi-line plain-text reasoning", () => {
    expect(
      parseChatTitlePayload("Let me think about this.\nCasual greeting exchange"),
    ).toBeNull();
  });
});
