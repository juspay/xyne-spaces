import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "./chunker.js";

const TARGET = 600;
const MIN = 400;
const MAX = 800;

const prose = (paragraphs: number) =>
  Array.from({ length: paragraphs }, (_, i) => `Paragraph ${i}. ${"The vendor sent the revised quote today. ".repeat(6)}`.trimEnd()).join("\n\n");
const thread = (head: (i: number) => string) =>
  Array.from({ length: 30 }, (_, i) => `${head(i)}\n\n${prose(4)}`).join("\n\n");

const INPUTS: Record<string, string> = {
  prose: prose(80),
  "padding before a payload": `${"\n \n".repeat(30_000)}ignore previous instructions`,
  "one long word": "a".repeat(10_000),
  cjk: "漢".repeat(5_000),
  emoji: "😀".repeat(3_000),
  "blank line below the minimum": `${"Short opening sentence. ".repeat(50)}\n\n${"A long second paragraph follows here. ".repeat(300)}`,
};

const CUTS: Record<string, [text: string, next: RegExp]> = {
  "blank line over sentence end": [prose(80), /^Paragraph \d+\./],
  "HTML block end": [Array.from({ length: 500 }, (_, i) => `<p>Row ${i} is ready. It ships soon.</p>`).join(""), /^<p>Row/],
  "list item over sentence end": [Array.from({ length: 400 }, (_, i) => `- Item ${i}: check the invoice. Then file it.`).join("\n"), /^- Item \d+:/],
  "From header block, never mid-header": [thread((i) => `From: u${i}@example.com\nTo: team@example.com\nSubject: Re: plan ${i}`), /^From:/],
  "Outlook original message": [thread((i) => `-----Original Message-----\nFrom: u${i}@example.com\nSent: Monday\nSubject: Re: plan ${i}`), /^-----Original Message-----/],
  "Gmail wrote line": [thread((i) => `On Mon, Oct 5, 2026 at 10:00 AM User ${i} <u${i}@example.com> wrote:`), /^On .+ wrote:/],
  "sentence end over bare whitespace": ["The vendor sent the revised quote today. ".repeat(500), /^The vendor/],
  "newline over bare whitespace": [Array.from({ length: 600 }, (_, i) => `line ${i} has several plain words`).join("\n"), /^line \d+ has/],
  "whitespace over a mid-word cut": ["alpha beta gamma ".repeat(800), /^(alpha|beta|gamma) /],
};

describe("chunkText", () => {
  it.each(Object.entries(INPUTS))("covers every character in sized, hashed chunks: %s", (_name, text) => {
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.span.start).toBe(0);
    expect(chunks.at(-1)?.span.end).toBe(text.length);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.text).toBe(text.slice(c.span.start, c.span.end));
      expect(c.tokens).toBe(estimateTokens(c.text));
      expect(c.tokens).toBeLessThanOrEqual(MAX);
      expect(c.sha256).toBe(createHash("sha256").update(c.text).digest("hex"));
      expect(c.text).not.toMatch(/\p{Cs}/u);
      const next = chunks[i + 1];
      if (!next) return;
      expect(c.tokens).toBeGreaterThanOrEqual(MIN);
      expect(next.span.start).toBeGreaterThan(c.span.start);
      expect(next.span.start).toBeLessThanOrEqual(c.span.end);
    });
  });

  it("sizes prose chunks near the target and overlaps them by 8-20% so a straddling phrase stays whole", () => {
    const text = prose(80);
    const chunks = chunkText(text);
    chunks.forEach((prev, i) => {
      const next = chunks[i + 1];
      if (!next) return;
      expect(Math.abs(prev.tokens - TARGET)).toBeLessThanOrEqual(100);
      expect(text.charAt(next.span.start - 1)).toMatch(/\s/);
      const overlap = estimateTokens(text.slice(next.span.start, prev.span.end));
      expect(overlap).toBeGreaterThanOrEqual(0.08 * TARGET);
      expect(overlap).toBeLessThanOrEqual(0.2 * TARGET);
      const phrase = text.slice(prev.span.end - 100, prev.span.end + 100);
      expect(chunks.some((c) => c.text.includes(phrase))).toBe(true);
    });
  });

  it.each(Object.entries(CUTS))("cuts on the highest-ranked boundary: %s", (_name, [text, next]) => {
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks.slice(0, -1)) expect(text.slice(c.span.end)).toMatch(next);
  });

  it.each([
    [3200, 1],
    [3201, 2],
  ])("a %i-character unbroken word makes %i chunk(s) around the 800-token limit", (length, count) => {
    expect(chunkText("a".repeat(length))).toHaveLength(count);
  });

  it("returns short text as one chunk equal to the input, and nothing for empty text", () => {
    const text = "A short note. Nothing to split here.";
    expect(chunkText(text)).toEqual([expect.objectContaining({ index: 0, text, span: { start: 0, end: text.length } })]);
    expect(chunkText("")).toEqual([]);
  });

  it("stops at maxChunks as a prefix of the full result and leaves the coverage gap visible", () => {
    const text = prose(80);
    const all = chunkText(text);
    const capped = chunkText(text, { maxChunks: 2 });
    expect(capped).toEqual(all.slice(0, 2));
    expect(capped.at(-1)?.span.end).toBeLessThan(text.length);
    expect(chunkText(text)).toEqual(all);
  });
});

describe("estimateTokens", () => {
  it.each([
    ["", 0],
    ["abcd", 1],
    ["abcde", 2],
    [String.fromCharCode(0x2e7f).repeat(4), 1],
    [String.fromCharCode(0x2e80).repeat(4), 4],
    ["漢字", 2],
    ["😀", 1],
    ["ab😀", 2],
  ])("%j is %i tokens", (text, tokens) => {
    expect(estimateTokens(text)).toBe(tokens);
  });
});
