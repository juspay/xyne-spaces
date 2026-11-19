import { EXTRACTORS } from '../enc-contracts/extractors.js';
import type { DerivedFacts, ExtractorName, ExtractorOutput, FieldFacts } from '../enc-contracts/extractors.js';
import { extractMentions } from './mentions.js';
import { extractLinks } from './links.js';
import { extractCommand } from './command.js';
import { extractText } from './text.js';

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

const EXTRACTOR_FNS: { [K in ExtractorName]: (text: string) => ExtractorOutput[K] } = {
  mentions: extractMentions,
  links: extractLinks,
  command: extractCommand,
  text: extractText,
};

/**
 * Runs the requested extractors over ONE field's plaintext. Pure (no I/O), so the encryption
 * service can run it next to the plaintext and hand the backend only the facts.
 */
export function runExtractors(text: string, names: readonly ExtractorName[]): FieldFacts {
  const facts: FieldFacts = {};
  for (const name of names) {
    (facts as Record<string, unknown>)[name] = EXTRACTOR_FNS[name](text);
  }
  return facts;
}

/**
 * Keeps, per extractor, only the output keys a contract picked. A `null` output (not a
 * command) stays `null`.
 */
export function projectFacts(facts: FieldFacts, selection: Readonly<Record<string, readonly string[]>>): FieldFacts {
  const out: Record<string, unknown> = {};
  for (const [name, keys] of Object.entries(selection)) {
    if (!(name in facts)) continue;
    const value = (facts as Record<string, unknown>)[name];
    if (value === null || typeof value !== 'object') {
      out[name] = value;
      continue;
    }
    const picked: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in value) picked[key] = (value as Record<string, unknown>)[key];
    }
    out[name] = picked;
  }
  return out as FieldFacts;
}

/**
 * The facts for a request body whose source fields arrived as plaintext: per field, the
 * extractors its contract entry names are run over the field's text and projected to the
 * picked keys, and the results are keyed by field. Nothing is merged across fields. A field
 * is skipped when it is not a non-empty string or is already ciphertext (`ENC:`). This is the
 * backend's stand-in for the encryption service's transform when the client did not encrypt,
 * so a handler reads the same `derived` either way. Returns undefined when no field produced
 * facts.
 */
export function deriveFactsFromPlaintext(
  body: Record<string, unknown>,
  selection: Readonly<Record<string, Readonly<Record<string, readonly string[]>> | undefined>>,
): DerivedFacts | undefined {
  const fields: Record<string, FieldFacts> = {};
  for (const field of Object.keys(selection).sort()) {
    const perExtractor = selection[field] ?? {};
    const names = Object.keys(perExtractor).filter((n): n is ExtractorName => (EXTRACTORS as readonly string[]).includes(n));
    if (names.length === 0) continue;
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('ENC:')) continue;
    fields[field] = projectFacts(runExtractors(value, names), perExtractor);
  }
  return Object.keys(fields).length === 0 ? undefined : { version: 2, fields };
}
