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

const HTML_INPUT = /<input\b[^>]*>/gi;
/** Buttons are very often cased in CSS rather than in the markup. */
const CSS_UPPERCASE = /text-transform\s*:\s*uppercase/i;

/** Never has content, so a scan must not wait for a close tag. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Tags whose CONTENT is not copy — their text sits between tags rather than
 *  inside one, so stripping tags alone leaves a `.synergy-grid` selector and a
 *  `const delve = utilize()` reading as prose. */
const RAW_TEXT_TAGS = new Set(["style", "script", "pre", "code", "template"]);

interface ScannedElement {
  tag: string;
  /** The whole opening tag, `<a class="btn" href="/x">`. */
  openTag: string;
  /** Text between the open and its matching close. */
  inner: string;
  /** Offset of the opening `<`, for the line number. */
  index: number;
  innerStart: number;
  innerEnd: number;
}

/**
 * Every element in the document, in one forward pass.
 *
 * Replaces five `<tag>([\s\S]*?)</tag>` regexes. Each of those restarted its
 * lazy scan at every candidate open tag and ran it to the end of the input, so
 * an artifact with unclosed tags cost quadratic time — measured at 143 / 558 /
 * 2215 / 8929 ms for 10k / 20k / 40k / 80k unclosed `<div class="btn">`, a
 * clean 4x per doubling, all of it synchronous in the claw process. This visits
 * each character once.
 *
 * Quote-aware so `<a title="a > b">` does not end early, and stack-based so a
 * close tag pairs with its own open rather than the nearest one.
 */
function scanElements(html: string): ScannedElement[] {
  const found: ScannedElement[] = [];
  const open: Array<Omit<ScannedElement, "inner" | "innerEnd">> = [];
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }

    let cursor = lt + 1;
    let quote: string | null = null;
    while (cursor < html.length) {
      const char = html[cursor] as string;
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
      cursor += 1;
    }
    if (cursor >= html.length) break;

    const raw = html.slice(lt, cursor + 1);
    const name = /^<\/?\s*([a-z][\w-]*)/i.exec(raw);
    if (!name) {
      index = cursor + 1;
      continue;
    }
    const tag = (name[1] as string).toLowerCase();

    if (raw.startsWith("</")) {
      for (let depth = open.length - 1; depth >= 0; depth -= 1) {
        const candidate = open[depth] as Omit<ScannedElement, "inner" | "innerEnd">;
        if (candidate.tag !== tag) continue;
        found.push({
          ...candidate,
          inner: html.slice(candidate.innerStart, lt),
          innerEnd: lt,
        });
        open.length = depth;
        break;
      }
    } else if (raw.endsWith("/>") || VOID_TAGS.has(tag)) {
      found.push({
        tag,
        openTag: raw,
        inner: "",
        index: lt,
        innerStart: cursor + 1,
        innerEnd: cursor + 1,
      });
    } else {
      open.push({ tag, openTag: raw, index: lt, innerStart: cursor + 1 });
    }
    index = cursor + 1;
  }
  return found;
}

/** Same length, same newlines — so every offset and line number downstream
 *  still refers to the caller's own content. */
const blankOut = (text: string): string => text.replace(/[^\n]/g, " ");

/** Lower-cased in title case; capitalised anywhere else only at the start or
 *  the end of the phrase. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "off", "on", "out", "per", "to", "up",
  "via", "vs", "with", "from", "into", "over", "than",
]);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/** The same one pass, but blanking in place so offsets survive — what
 *  visibleCopy needs. */
function blankHtmlComments(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const start = text.indexOf("<!--", from);
    if (start === -1) return out + text.slice(from);
    out += text.slice(from, start);
    const end = text.indexOf("-->", start + 4);
    const stop = end === -1 ? text.length : end + 3;
    out += blankOut(text.slice(start, stop));
    if (end === -1) return out;
    from = stop;
  }
}

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

/**
 * The document with everything that is NOT copy blanked out, character for
 * character.
 *
 * Offset-preserving on purpose. The old version stripped tags one line at a
 * time, which had two consequences: the attributes on the continuation lines of
 * a tag spread over several lines were treated as copy — so `href="/login"` and
 * `class="synergy-link"` were reported as findings — and a phrase could not be
 * matched across a line break even though the phrase pattern allows one, so
 * `best\n in class` was missed. Blanking in place instead means the scan runs
 * over the whole document while every line number still refers to the caller's
 * own content.
 *
 * Blanked, in order: the content of raw-text elements, every tag, HTML
 * comments, fenced code blocks, inline code, and the URL half of a markdown
 * link.
 */
function visibleCopy(content: string, fenced: readonly boolean[], starts: readonly number[]): string {
  const chars = [...content];
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < chars.length; at += 1) {
      if (chars[at] !== "\n") chars[at] = " ";
    }
  };

  for (const element of scanElements(content)) {
    // The element's text, when the element is one whose content is not copy.
    if (RAW_TEXT_TAGS.has(element.tag)) blank(element.innerStart, element.innerEnd);
    // The tags themselves, open and close.
    blank(element.index, element.innerStart);
    if (element.innerEnd > element.innerStart) {
      const close = content.indexOf(">", element.innerEnd);
      blank(element.innerEnd, close === -1 ? content.length : close + 1);
    }
  }

  let text = chars.join("");
  // An unclosed tag leaves no element, so sweep whatever tag-shaped text is
  // left. Bounded to a single line, which is what an unclosed tag is.
  text = text.replace(/<[^>\n]*>?/g, (tag) => blankOut(tag));
  text = blankHtmlComments(text);
  text = text.replace(/`[^`\n]*`/g, (code) => blankOut(code));
  // Keep the link label, lose the URL.
  text = text.replace(/\]\([^)\n]*\)/g, (url) => blankOut(url));
  text = text.replace(/^(\s{0,3}#{1,6}\s+)/gm, (hashes) => blankOut(hashes));

  // Fenced blocks, by line.
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced[index]) lines[index] = blankOut(lines[index] ?? "");
  }
  void starts;
  return lines.join("\n");
}

/** Tags and inline code gone from a short fragment — a heading or button label
 *  already carved out by the scanner. Not offset-preserving; callers only want
 *  the words. */
function fragmentText(fragment: string): string {
  return stripHtmlComments(fragment)
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ");
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

/** Offsets covered by a raw-text element's content. A heading or a button that
 *  only exists inside a `<code>` example is markup being shown, not copy being
 *  delivered, so it is not checked. */
function rawTextRanges(elements: readonly ScannedElement[]): ReadonlyArray<readonly [number, number]> {
  return elements
    .filter((element) => RAW_TEXT_TAGS.has(element.tag))
    .map((element) => [element.innerStart, element.innerEnd] as const);
}

const isInsideRawText = (
  ranges: ReadonlyArray<readonly [number, number]>,
  at: number,
): boolean => ranges.some(([from, to]) => at >= from && at < to);

/** Elements the scanner found, filtered and turned into candidates. */
function elementCandidates(
  elements: readonly ScannedElement[],
  wanted: (element: ScannedElement) => boolean,
  starts: readonly number[],
  fenced: readonly boolean[],
  rawRanges: ReadonlyArray<readonly [number, number]>,
): Candidate[] {
  const found: Candidate[] = [];
  for (const element of elements) {
    if (!wanted(element)) continue;
    if (isInsideRawText(rawRanges, element.index)) continue;
    const line = lineAt(starts, element.index);
    if (fenced[line - 1]) continue;
    const text = collapse(fragmentText(element.inner));
    if (text) found.push({ text, line });
  }
  return found;
}

/** An `<a>` or `<button>` carrying a btn-ish class or `role="button"`. The
 *  class value is pulled out before being tested: `[^"]*\b(btn|…)\b[^"]*"` has
 *  two unbounded classes competing either side of the keyword. */
const CLASS_ATTR = /class\s*=\s*["']([^"']*)["']/i;
const BUTTON_CLASS = /\b(?:btn|btn[-_]\w+|button|cta)\b/i;
const ROLE_BUTTON = /role\s*=\s*["']button["']/i;

const isButtonish = (element: ScannedElement): boolean =>
  element.tag === "button" ||
  ROLE_BUTTON.test(element.openTag) ||
  BUTTON_CLASS.test(CLASS_ATTR.exec(element.openTag)?.[1] ?? "");

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

  const lines = content.split(/\r?\n/);
  const fenced = fencedLines(lines);
  const starts = lineStarts(lines);
  const findings: VoiceToneFinding[] = [];
  // One pass for the whole document, reused by the heading and button checks.
  const elements = scanElements(content);
  // Copy with every non-copy region blanked in place. Scanned as one string
  // rather than line by line, so a phrase can match across a line break and a
  // multi-line tag's attributes cannot be read as prose.
  const copy = visibleCopy(content, fenced, starts);
  const rawRanges = rawTextRanges(elements);

  // --- Phrases, over visible copy only ------------------------------------
  const banned = rules.bannedPhrases.map((phrase) => ({ phrase, pattern: phrasePattern(phrase) }));
  const wording = rules.preferredWording.map((pair) => ({ pair, pattern: phrasePattern(pair.avoid) }));
  /** `line:matched` of a banned hit, so the same words are not also reported as
   *  preferred wording. A phrase that is both gets the stronger finding. */
  const bannedHits = new Set<string>();

  {
    const text = copy;

    for (const { phrase, pattern } of banned) {
      pattern.lastIndex = 0;
      let match = pattern.exec(text);
      while (match !== null) {
        const matchedText = match[0];
        const line = lineAt(starts, match.index);
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
        const line = lineAt(starts, match.index);
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
      if (isInsideRawText(rawRanges, starts[index] ?? 0)) continue;
      const text = collapse(fragmentText((markdown[2] ?? "").replace(ATX_CLOSING_HASHES, "")));
      if (text) headings.push({ text, line: index + 1 });
    }
    headings.push(
      ...elementCandidates(elements, (element) => /^h[1-6]$/.test(element.tag), starts, fenced, rawRanges),
    );

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
      ...elementCandidates(elements, isButtonish, starts, fenced, rawRanges),
      ...inputButtons(content, starts, fenced),
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
