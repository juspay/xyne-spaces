import { describe, expect, it } from "vitest";
import { OVERFLOW_NOTE, checkReplyFormat, parseReplyFormat, countWords, planSectionedReply, replyFormatNudge, splitIntoSections, truncateWords } from "./sections.js";

const limits = { maxWords: 100, maxSections: 5 };
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

describe("splitIntoSections", () => {
  it("starts a section at each markdown or bold-line heading and keeps the intro", () => {
    const md = `Intro line\n\n## First\nalpha\n\n**Second**\nbeta\n\n### Third\ngamma`;
    expect(splitIntoSections(md)).toEqual(["Intro line", "## First\nalpha", "**Second**\nbeta", "### Third\ngamma"]);
  });

  it("does not split on headings inside a code block", () => {
    const md = "## Code\n```\n# not a heading\n```\nafter";
    expect(splitIntoSections(md)).toEqual(["## Code\n```\n# not a heading\n```\nafter"]);
  });

  it("returns nothing for blank input", () => {
    expect(splitIntoSections(" \n\n ")).toEqual([]);
  });
});

describe("truncateWords", () => {
  it("leaves short text untouched", () => {
    expect(truncateWords("a b c", 5)).toEqual({ text: "a b c", truncated: false });
  });

  it("cuts at the word limit and marks the cut", () => {
    const { text, truncated } = truncateWords(`${words(4)}\n${words(4)}`, 6);
    expect(truncated).toBe(true);
    expect(countWords(text.replace("…", ""))).toBe(6);
    expect(text.endsWith("…")).toBe(true);
  });

  it("closes a code block that the cut leaves open", () => {
    const { text } = truncateWords("```\none two three four\nfive six\n```", 3);
    expect(text.trim().endsWith("```")).toBe(true);
  });
});

describe("planSectionedReply", () => {
  it("sends each section on its own without a file when everything fits", () => {
    const plan = planSectionedReply("## A\nshort\n\n## B\nalso short", limits);
    expect(plan).toEqual({ messages: ["## A\nshort", "## B\nalso short"], overflow: false });
  });

  it("caps each section at 100 words and points to the file", () => {
    const plan = planSectionedReply(`## Long\n${words(150)}`, limits);
    expect(plan.overflow).toBe(true);
    expect(plan.messages).toHaveLength(1);
    expect(countWords(plan.messages[0]!.replace(OVERFLOW_NOTE, "").replace("…", ""))).toBe(100);
    expect(plan.messages[0]!.endsWith(OVERFLOW_NOTE)).toBe(true);
  });

  it("sends at most 5 sections and moves the rest to the file", () => {
    const md = Array.from({ length: 7 }, (_, i) => `## S${i + 1}\nbody ${i + 1}`).join("\n\n");
    const plan = planSectionedReply(md, limits);
    expect(plan.messages).toHaveLength(5);
    expect(plan.overflow).toBe(true);
    expect(plan.messages[4]).toContain("## S5");
    expect(plan.messages[4]).toContain(OVERFLOW_NOTE);
    expect(plan.messages.join("\n")).not.toContain("S6");
  });

  it("treats an answer without headings as one section", () => {
    const plan = planSectionedReply(words(40), limits);
    expect(plan).toEqual({ messages: [words(40)], overflow: false });
  });
});

describe("checkReplyFormat", () => {
  it("passes an answer that already fits", () => {
    expect(checkReplyFormat("**A**\nshort\n\n**B**\nalso short", limits)).toEqual({ ok: true, problems: [] });
  });

  it("names every violation so the agent knows what to fix", () => {
    const md = [`**Root cause**\n${words(120)}`, ...Array.from({ length: 5 }, (_, i) => `**S${i}**\nx`)].join("\n\n");
    const check = checkReplyFormat(md, limits);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual(["6 sections (max 5)", 'section "Root cause" has 122 words (max 100)']);
  });
});

describe("replyFormatNudge", () => {
  it("lists the problems and the limits", () => {
    const nudge = replyFormatNudge(["6 sections (max 5)"], limits);
    expect(nudge).toContain("6 sections (max 5)");
    expect(nudge).toContain("at most 5 sections");
    expect(nudge).toContain("under 100 words");
  });
});

describe("parseReplyFormat", () => {
  it("accepts positive integer limits and rejects anything else", () => {
    expect(parseReplyFormat({ maxSections: 5, maxWords: 100 })).toEqual({ maxSections: 5, maxWords: 100 });
    expect(parseReplyFormat({ maxSections: "5", maxWords: "100" })).toEqual({ maxSections: 5, maxWords: 100 });
    expect(parseReplyFormat({ maxSections: 0, maxWords: 100 })).toBeUndefined();
    expect(parseReplyFormat({ maxWords: 100 })).toBeUndefined();
    expect(parseReplyFormat(undefined)).toBeUndefined();
  });
});
