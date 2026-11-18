import type { DerivedContentFacts, ExtractorName, ExtractorOutput } from '../enc-contracts/extractors.js';
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
