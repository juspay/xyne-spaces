import type { DerivedContentFacts, ExtractorName, ExtractorOutput } from '../enc-contracts/extractors.js';
import { extractMentions } from './mentions.js';
import { extractLinks } from './links.js';
import { extractCommand } from './command.js';
import { extractText } from './text.js';
import { extractArtifact } from './artifact.js';

export { extractMentions, extractSpecialMentionFlags } from './mentions.js';
export {
  extractLinks,
  extractUrls,
  extractFirstUrl,
  stripAndDecodeHtml,
  trimSurroundingPunctuation,
  URL_REGEX,
  PR_LINK_REGEX,
  GOOGLE_MEET_REGEX,
} from './links.js';
export {
  extractCommand,
  parseBotCommandText,
  isBotCommandContent,
  stripBotCommandContent,
  BOT_COMMAND_REGEX,
  BOT_PARAM_REGEX,
} from './command.js';
export type { ParsedBotCommandText } from './command.js';
export { extractText } from './text.js';
export { extractArtifact } from './artifact.js';

const EXTRACTOR_FNS: { [K in ExtractorName]: (text: string) => ExtractorOutput[K] } = {
  mentions: extractMentions,
  links: extractLinks,
  command: extractCommand,
  text: extractText,
  artifact: extractArtifact,
};

/**
 * Runs the requested extractors over plaintext. Pure (no I/O), so the encryption service
 * can run it next to the plaintext and hand the backend only the facts.
 */
export function runExtractors(text: string, names: readonly ExtractorName[]): DerivedContentFacts {
  const facts: DerivedContentFacts = { version: 1 };
  for (const name of names) {
    (facts as Record<string, unknown>)[name] = EXTRACTOR_FNS[name](text);
  }
  return facts;
}

/**
 * Folds the facts of several fields into one, with the encryption service's rules
 * (apps/encryption-rust/src/extractor.rs merge_facts): arrays union in order, `isEmpty` ANDs,
 * other booleans OR, numbers add, nested objects merge key by key, `command` and strings keep
 * the first non-null value. Field order is the caller's, so callers sort for determinism.
 */
export function mergeDerivedFacts(parts: readonly DerivedContentFacts[]): DerivedContentFacts {
  const out: Record<string, unknown> = { version: 1 };
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key === 'version') continue;
      if (!(key in out)) {
        out[key] = clone(value);
        continue;
      }
      out[key] = mergeValue(out[key], value, key);
    }
  }
  return out as DerivedContentFacts;
}

function mergeValue(acc: unknown, value: unknown, key: string): unknown {
  if (acc === null || acc === undefined) return clone(value);
  if (value === null || value === undefined) return acc;
  if (Array.isArray(acc) && Array.isArray(value)) {
    const merged = [...acc];
    for (const item of value) {
      if (!merged.some(existing => sameJson(existing, item))) merged.push(clone(item));
    }
    return merged;
  }
  if (typeof acc === 'boolean' && typeof value === 'boolean') {
    return key === 'isEmpty' ? acc && value : acc || value;
  }
  if (typeof acc === 'number' && typeof value === 'number') return acc + value;
  if (isPlainObject(acc) && isPlainObject(value) && key !== 'command') {
    const merged: Record<string, unknown> = { ...acc };
    for (const [k, v] of Object.entries(value)) {
      merged[k] = k in merged ? mergeValue(merged[k], v, k) : clone(v);
    }
    return merged;
  }
  // Strings, the first `command` object and mismatched shapes: keep the first.
  return acc;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function clone<T>(v: T): T {
  return v === null || typeof v !== 'object' ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/**
 * The facts for a request body whose contract fields arrived as plaintext: the extractors are
 * run over each named field that is a non-empty string not already ciphertext (`ENC:`), in
 * sorted field order, and merged. This is the backend's stand-in for the encryption service's
 * transform when the client did not encrypt (encryption off, or the service unavailable to the
 * client), so a handler reads the same `derived` either way. Returns undefined when nothing
 * was extracted, so the handler can tell "no facts" from "facts of empty text".
 */
export function deriveFactsFromPlaintext(
  body: Record<string, unknown>,
  fields: readonly string[],
  extractors: readonly ExtractorName[],
): DerivedContentFacts | undefined {
  if (extractors.length === 0) return undefined;
  const parts: DerivedContentFacts[] = [];
  for (const field of [...fields].sort()) {
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('ENC:')) continue;
    parts.push(runExtractors(value, extractors));
  }
  return parts.length === 0 ? undefined : mergeDerivedFacts(parts);
}
