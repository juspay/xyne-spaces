import type { UsageCorpus, UsageSample } from "./types.js";

/**
 * Redact stage: identifier-shaped text becomes shape-preserving placeholders.
 *
 * Pure and applied before anything leaves this process. The model is never
 * asked to refrain from copying an identifier — it never sees one. A usage file
 * is read by the whole org, so a surviving identifier is a leak from one user
 * to everyone, unlike a per-user memory file where the reader is the subject.
 *
 * Placeholders are words, not redaction bars: "refund for <id> on <url>" still
 * carries the sentence's shape, which is the part a pattern is drawn from.
 */

export const PLACEHOLDER = {
  email: "<email>",
  url: "<url>",
  id: "<id>",
  path: "<path>",
} as const;

/** Below these lengths a run of characters is far more likely to be a word, a
 *  quantity or a date part than an identifier. */
const MIN_HEX = 16;
const MIN_DIGITS = 7;
const MIN_MIXED_TOKEN = 10;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`)\]}]+/gi;
const FILE_PATH = /(?:^|(?<=\s))(?:~|\.{1,2})?\/[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = new RegExp(String.raw`\b[0-9a-f]{${MIN_HEX},}\b`, "gi");
const LONG_DIGITS = new RegExp(String.raw`\b\d{${MIN_DIGITS},}\b`, "g");
const WORD_TOKEN = new RegExp(String.raw`\b[A-Za-z0-9_]{${MIN_MIXED_TOKEN},}\b`, "g");

const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;

/**
 * True for a bare token that mixes letters and digits above the length
 * threshold — cuids, api keys, order references. Separator-delimited names
 * (`XYNE-63235`, `2026-09-15`) split into short segments and survive, which is
 * what keeps a redacted task readable.
 */
function isIdentifierToken(token: string): boolean {
  return token.length >= MIN_MIXED_TOKEN && HAS_LETTER.test(token) && HAS_DIGIT.test(token);
}

/**
 * Order matters: the composite shapes (email, URL, path) are consumed first, so
 * their parts are never independently rewritten into an unreadable smear of
 * placeholders.
 */
export function redactText(text: string): string {
  if (!text) return "";
  return text
    .replace(EMAIL, PLACEHOLDER.email)
    .replace(URL, PLACEHOLDER.url)
    .replace(FILE_PATH, PLACEHOLDER.path)
    .replace(UUID, PLACEHOLDER.id)
    .replace(LONG_HEX, PLACEHOLDER.id)
    .replace(LONG_DIGITS, PLACEHOLDER.id)
    .replace(WORD_TOKEN, (token) => (isIdentifierToken(token) ? PLACEHOLDER.id : token));
}

/** Only `task` is free text — tool names are machine names carrying no payload. */
export function redactSample(sample: UsageSample): UsageSample {
  return { ...sample, task: redactText(sample.task) };
}

export function redactCorpus(corpus: UsageCorpus): UsageCorpus {
  return { ...corpus, samples: corpus.samples.map(redactSample) };
}
