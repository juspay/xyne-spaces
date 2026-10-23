/**
 * The voice and tone QA check (XYNE-66830).
 *
 * A pure function over delivered content — markdown or HTML — and the
 * `VoiceRules` parsed out of a design system's DESIGN.md. It has no opinion
 * about what the caller does with the findings; it is deliberately NOT a
 * delivery gate.
 *
 * What it checks and what it refuses to:
 *
 *  - Copy, not markup. Tags, link URLs, fenced blocks and the CONTENT of
 *    `<style>`, `<script>`, `<pre>`, `<code>` and `<template>` are all removed
 *    before any scan, so neither `class="synergy-grid"`, nor a
 *    `.synergy-grid` selector in a stylesheet, nor a code sample that happens
 *    to say `utilize`, is a finding. A QA check that reports markup gets
 *    switched off, and then it is checking nothing.
 *  - Casing conservatively. Proper nouns are indistinguishable from title case
 *    to any amount of regex, so the heuristics below are tuned to stay quiet
 *    on "Built with GitHub Actions" at the cost of missing the occasional real
 *    violation. Same reasoning: a check that cries wolf gets switched off.
 *  - Suggestions only where the fix is unambiguous. Capitalising a word for
 *    title case is always right; LOWER-casing one for sentence case is a guess
 *    about whether it is a proper noun, so those findings name the offending
 *    words and leave the rewrite to a human.
 */

import type { VoiceCasing, VoiceRules } from "./voice-tone.js";

export type VoiceToneFindingType =
  | "banned-phrase"
  | "preferred-wording"
  | "heading-casing"
  | "button-casing";

export interface VoiceToneFinding {
  type: VoiceToneFindingType;
  /** Written for the person fixing it, naming the rule that was broken. */
  message: string;
  /** 1-based line in the content that was passed in. */
  line: number;
  /** The exact text that broke the rule. */
  matchedText: string;
  /** Only present when the correction is unambiguous. */
  suggestion?: string;
}

const FENCE = /^\s*(?:```|~~~)/;
/** Three adjacent quantifiers that all match a space — `(.+?)`, `\s*`, `\s*`
 *  — backtracked against each other. The closing hashes of an ATX heading are
 *  stripped after the match instead, with ATX_CLOSING_HASHES. */
const MARKDOWN_HEADING = /^\s{0,3}(#{1,6})\s+(\S.*)$/;
/** `## Title ##` — the optional closing run, removed after the match. */
const ATX_CLOSING_HASHES = /\s*#+\s*$/;
/** A line that is nothing but a link reads as a call to action. */
const STANDALONE_LINK = /^\s*\*{0,2}\[([^\]]+)\]\([^)]*\)\*{0,2}\s*$/;

const HTML_HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
const HTML_BUTTON = /<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi;
const HTML_BUTTON_CLASS =
  /<(a|div|span|p)\b[^>]*\bclass\s*=\s*["'][^"']*(?:\bbtn\b|\bbtn[-_]|\bbutton\b)[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/gi;
const HTML_BUTTON_ROLE =
  /<([a-z][\w-]*)\b[^>]*\brole\s*=\s*["']button["'][^>]*>([\s\S]*?)<\/\1\s*>/gi;
const HTML_INPUT = /<input\b[^>]*>/gi;
/** Buttons are very often cased in CSS rather than in the markup. */
const CSS_UPPERCASE = /text-transform\s*:\s*uppercase/i;

/**
 * Elements whose CONTENT is not copy. Their text sits between tags rather than
 * inside one, so stripping tags leaves it behind: a `.seamlessly-grid` selector
 * in a `<style>` block and a `const delve = utilize()` in a `<pre><code>` both
 * read as prose otherwise. HTML is what a `/design` run delivers, so this is
 * the common case and not an edge one.
 */
const RAW_TEXT_ELEMENTS = /<(style|script|pre|code|template)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/** Lower-cased in title case; capitalised anywhere else only at the start or
 *  the end of the phrase. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "off", "on", "out", "per", "to", "up",
  "via", "vs", "with", "from", "into", "over", "than",
]);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/** One pass, not `/<!--[\s\S]*?-->/g`: that restarts its lazy scan at every
 *  `<!--` and runs to the end of the input, so markup holding many unclosed
 *  ones costs quadratic time. An unclosed comment runs to the end, which is
 *  what a browser does. */
function stripHtmlComments(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const start = text.indexOf("<!--", from);
    if (start === -1) return out + text.slice(from);
    out += `${text.slice(from, start)} `;
    const end = text.indexOf("-->", start + 4);
    if (end === -1) return out;
    from = end + 3;
  }
}

/** Tags, inline code and link syntax gone; what is left is what a reader sees. */
function visibleText(line: string): string {
  return stripHtmlComments(line)
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/, "");
}

/**
 * Blank out the content of every raw-text element, keeping newlines and the
 * character count so every line number and offset downstream still lines up
 * with the content the caller passed in.
 */
function maskRawTextElements(content: string): string {
  return content.replace(RAW_TEXT_ELEMENTS, (whole, _tag: string, inner: string) => {
    if (!inner) return whole;
    // `inner` begins immediately after the opening tag's `>`.
    const start = whole.indexOf(">") + 1;
    return `${whole.slice(0, start)}${inner.replace(/[^\n]/g, " ")}${whole.slice(start + inner.length)}`;
  });
}

/** Which lines sit inside a fenced block, markers included. */
function fencedLines(lines: readonly string[]): boolean[] {
  const flags: boolean[] = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      flags.push(true);
      fenced = !fenced;
      continue;
    }
    flags.push(fenced);
  }
  return flags;
}

interface Word {
  /** As written, punctuation included. */
  raw: string;
  /** Surrounding punctuation stripped. */
  clean: string;
  /** First word, or the first after `.`, `:`, `?`, `!` or a dash — where a
   *  capital is correct under sentence case. */
  startsSentence: boolean;
}

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const SENTENCE_END = /[.:!?—–]$/;

function tokenize(text: string): Word[] {
  const raws = collapse(text).split(" ").filter(Boolean);
  return raws.map((raw, index) => ({
    raw,
    clean: raw.replace(EDGE_PUNCTUATION, ""),
    startsSentence: index === 0 || SENTENCE_END.test(raws[index - 1] ?? ""),
  }));
}

const hasLetter = (value: string): boolean => /\p{L}/u.test(value);
/** `API`, `B2B`, `AI`. Never re-cased, in either direction. */
const isAcronym = (value: string): boolean =>
  value.length >= 2 && /^[\p{Lu}\p{N}]+$/u.test(value) && /\p{Lu}/u.test(value);
/** `GitHub`, `iPhone`, `eBay` — a brand, so its casing is already the answer. */
const isMixedCaps = (value: string): boolean =>
  /\p{Ll}/u.test(value) && /\p{Lu}/u.test(value.slice(1));
const isCapitalized = (value: string): boolean => /^\p{Lu}/u.test(value);
const isFunctionWord = (value: string): boolean => FUNCTION_WORDS.has(value.toLowerCase());
/** A word whose casing this check is willing to have an opinion about. */
const isRecasable = (word: Word): boolean =>
  hasLetter(word.clean) && !isAcronym(word.clean) && !isMixedCaps(word.clean);

interface CasingVerdict {
  message: string;
  suggestion?: string;
}

/**
 * Words that look title-cased under a sentence-case rule.
 *
 * Exempt: the first word, a word opening a new sentence, acronyms and brand
 * casing. Function words are NOT exempt — a capitalised "A" or "With" is the
 * strongest single signal of title case, because a sentence-caser never writes
 * one.
 */
function titleCasedWords(words: readonly Word[]): Word[] {
  return words.filter(
    (word, index) =>
      index > 0 && !word.startsSentence && isRecasable(word) && isCapitalized(word.clean),
  );
}

function checkSentenceCase(text: string): CasingVerdict | null {
  const words = tokenize(text);
  const offenders = titleCasedWords(words);
  if (offenders.length === 0) return null;

  /**
   * A lower-case function word is what a title-caser leaves behind, so its
   * presence means the capitals have to stack up before this is called: one
   * capital after "by", "with" or "to" is a brand name, not a casing style.
   *
   * With no function word at all there is nothing else to go on, and one
   * capital is enough. That is the difference between "Powered by Stripe" and
   * "Get Started", which are both three words.
   */
  const hasLowerFunctionWord = words.some(
    (word) => isFunctionWord(word.clean) && !isCapitalized(word.clean),
  );
  if (offenders.length < (hasLowerFunctionWord ? 2 : 1)) return null;

  return {
    message: `looks title-cased, but sentence case was asked for. Lower-case ${offenders
      .map((word) => `"${word.clean}"`)
      .join(", ")} unless they are proper nouns`,
  };
}

function toTitleCase(words: readonly Word[]): string {
  return words
    .map((word, index) => {
      if (!isRecasable(word)) return word.raw;
      const last = index === words.length - 1;
      if (index > 0 && !last && isFunctionWord(word.clean)) {
        return word.raw.toLowerCase();
      }
      return word.raw.replace(/\p{L}/u, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

function checkTitleCase(text: string): CasingVerdict | null {
  const words = tokenize(text);
  const offenders = words.filter((word, index) => {
    if (!isRecasable(word) || isCapitalized(word.clean)) return false;
    const last = index === words.length - 1;
    // A lower-case function word mid-phrase is correct title case.
    return index === 0 || last || !isFunctionWord(word.clean);
  });
  if (offenders.length === 0) return null;

  return {
    message: `is not title case. Capitalise ${offenders
      .map((word) => `"${word.clean}"`)
      .join(", ")}`,
    suggestion: toTitleCase(words),
  };
}

function checkUppercase(text: string): CasingVerdict | null {
  if (text === text.toUpperCase()) return null;
  return { message: "is not upper case", suggestion: text.toUpperCase() };
}

function checkCasing(text: string, casing: VoiceCasing): CasingVerdict | null {
  if (casing === "preserve") return null;
  if (!hasLetter(text)) return null;
  if (casing === "sentence-case") return checkSentenceCase(text);
  if (casing === "title-case") return checkTitleCase(text);
  return checkUppercase(text);
}

/** Word-bounded at both ends, and tolerant of wrapped whitespace inside a
 *  multi-word phrase. Boundaries are only applied where the phrase's own edge
 *  is a word character, so a phrase like "(beta)" still matches. */
function phrasePattern(phrase: string): RegExp {
  const body = phrase.trim().split(/\s+/).map(escapeForRegExp).join("\\s+");
  const prefix = /^[\p{L}\p{N}_]/u.test(phrase) ? "\\b" : "";
  const suffix = /[\p{L}\p{N}_]$/u.test(phrase) ? "\\b" : "";
  return new RegExp(`${prefix}${body}${suffix}`, "giu");
}

/** Enough of the line to recognise where the match is, centred on it. */
function snippet(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 30);
  const to = Math.min(text.length, index + length + 30);
  return `${from > 0 ? "…" : ""}${collapse(text.slice(from, to))}${to < text.length ? "…" : ""}`;
}

interface Candidate {
  text: string;
  line: number;
}

/** Offset of every line start, so a match in the whole document can be
 *  attributed to a line. */
function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

function lineAt(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Collect matches of an HTML element pattern, skipping fenced regions, taking
 *  the given capture group as the element's text. */
function htmlCandidates(
  content: string,
  pattern: RegExp,
  group: number,
  starts: readonly number[],
  fenced: readonly boolean[],
): Candidate[] {
  const found: Candidate[] = [];
  for (const match of content.matchAll(pattern)) {
    const line = lineAt(starts, match.index ?? 0);
    if (fenced[line - 1]) continue;
    const text = collapse(visibleText(match[group] ?? ""));
    if (text) found.push({ text, line });
  }
  return found;
}

function inputButtons(
  content: string,
  starts: readonly number[],
  fenced: readonly boolean[],
): Candidate[] {
  const found: Candidate[] = [];
  for (const match of content.matchAll(HTML_INPUT)) {
    const tag = match[0];
    if (!/\btype\s*=\s*["'](?:submit|button|reset)["']/i.test(tag)) continue;
    const value = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!value?.trim()) continue;
    const line = lineAt(starts, match.index ?? 0);
    if (fenced[line - 1]) continue;
    found.push({ text: collapse(value), line });
  }
  return found;
}

const FINDING_ORDER: Readonly<Record<VoiceToneFindingType, number>> = {
  "banned-phrase": 0,
  "preferred-wording": 1,
  "heading-casing": 2,
  "button-casing": 3,
};

/**
 * Check delivered content against a design system's voice rules.
 *
 * Returns every finding, unsorted caps and all — the caller decides what to do
 * with them. An empty array is a pass; there is no separate boolean, because
 * `findings.length === 0` cannot drift out of step with the findings.
 */
export function checkVoiceToneCompliance(
  content: string,
  rules: VoiceRules,
): VoiceToneFinding[] {
  if (!content) return [];

  // Everything below works off the masked copy, so a heading or a button label
  // inside a `<code>` example is not checked either. Masking preserves offsets,
  // so reported line numbers still refer to the caller's content.
  const masked = maskRawTextElements(content);
  const lines = masked.split(/\r?\n/);
  const fenced = fencedLines(lines);
  const starts = lineStarts(lines);
  const findings: VoiceToneFinding[] = [];

  // --- Phrases, over visible copy only ------------------------------------
  const banned = rules.bannedPhrases.map((phrase) => ({ phrase, pattern: phrasePattern(phrase) }));
  const wording = rules.preferredWording.map((pair) => ({ pair, pattern: phrasePattern(pair.avoid) }));
  /** `line:matched` of a banned hit, so the same words are not also reported as
   *  preferred wording. A phrase that is both gets the stronger finding. */
  const bannedHits = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    if (fenced[index]) continue;
    const text = visibleText(lines[index] ?? "");
    if (!text.trim()) continue;
    const line = index + 1;

    for (const { phrase, pattern } of banned) {
      pattern.lastIndex = 0;
      let match = pattern.exec(text);
      while (match !== null) {
        const matchedText = match[0];
        bannedHits.add(`${line}:${matchedText.toLowerCase()}`);
        findings.push({
          type: "banned-phrase",
          message: `Banned phrase "${phrase}" — ${snippet(text, match.index, matchedText.length)}`,
          line,
          matchedText,
        });
        match = pattern.exec(text);
      }
    }

    for (const { pair, pattern } of wording) {
      pattern.lastIndex = 0;
      let match = pattern.exec(text);
      while (match !== null) {
        const matchedText = match[0];
        if (!bannedHits.has(`${line}:${matchedText.toLowerCase()}`)) {
          findings.push({
            type: "preferred-wording",
            message: `Prefer "${pair.prefer}" over "${pair.avoid}" — ${snippet(text, match.index, matchedText.length)}`,
            line,
            matchedText,
            suggestion: pair.prefer,
          });
        }
        match = pattern.exec(text);
      }
    }
  }

  // --- Heading casing ------------------------------------------------------
  const headingRule = rules.casing.headings;
  if (headingRule) {
    const headings: Candidate[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (fenced[index]) continue;
      const markdown = MARKDOWN_HEADING.exec(lines[index] ?? "");
      if (!markdown) continue;
      const text = collapse(visibleText((markdown[2] ?? "").replace(ATX_CLOSING_HASHES, "")));
      if (text) headings.push({ text, line: index + 1 });
    }
    headings.push(...htmlCandidates(masked, HTML_HEADING, 2, starts, fenced));

    for (const heading of headings) {
      const verdict = checkCasing(heading.text, headingRule);
      if (!verdict) continue;
      findings.push({
        type: "heading-casing",
        message: `Heading "${heading.text}" ${verdict.message}`,
        line: heading.line,
        matchedText: heading.text,
        ...(verdict.suggestion === undefined ? {} : { suggestion: verdict.suggestion }),
      });
    }
  }

  // --- Button and CTA casing ----------------------------------------------
  const buttonRule = rules.casing.buttons;
  if (buttonRule) {
    const buttons: Candidate[] = [
      ...htmlCandidates(masked, HTML_BUTTON, 1, starts, fenced),
      ...htmlCandidates(masked, HTML_BUTTON_CLASS, 2, starts, fenced),
      ...htmlCandidates(masked, HTML_BUTTON_ROLE, 2, starts, fenced),
      ...inputButtons(masked, starts, fenced),
    ];
    for (let index = 0; index < lines.length; index += 1) {
      if (fenced[index]) continue;
      const link = STANDALONE_LINK.exec(lines[index] ?? "");
      const text = collapse(link?.[1] ?? "");
      if (text) buttons.push({ text, line: index + 1 });
    }

    // `<button class="btn">` matches two of the patterns above.
    const seen = new Set<string>();
    // Casing an upper-case brand in CSS is the norm, so a `text-transform`
    // anywhere in the content is taken as the rule being met in the stylesheet
    // rather than in every label.
    // Deliberately the UNMASKED content: `text-transform` lives inside the
    // `<style>` block, whose body is blanked out everywhere else.
    const cssUppercases = buttonRule === "uppercase" && CSS_UPPERCASE.test(content);

    for (const button of buttons) {
      const key = `${button.line}:${button.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cssUppercases) continue;

      const verdict = checkCasing(button.text, buttonRule);
      if (!verdict) continue;
      findings.push({
        type: "button-casing",
        message: `Button "${button.text}" ${verdict.message}`,
        line: button.line,
        matchedText: button.text,
        ...(verdict.suggestion === undefined ? {} : { suggestion: verdict.suggestion }),
      });
    }
  }

  return findings.sort(
    (a, b) => a.line - b.line || FINDING_ORDER[a.type] - FINDING_ORDER[b.type],
  );
}
