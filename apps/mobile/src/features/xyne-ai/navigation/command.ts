import { NAVIGATION_ACTIONS, type EntityKind } from './catalog';

const MAX_WORDS = 12;
const MAX_LENGTH = 200;

const VERBS = String.raw`open|go ?to|show(?:\s+me)?|take\s+me\s+to|navigate\s+to|message|dm|chat\s+with|text|view|launch`;
// "please", "can you", "could you please", "please can you just" ... before the verb.
const POLITE_LEAD = String.raw`(?:(?:please|pls|kindly|(?:can|could|would|will)\s+you|can\s+u)\s+(?:just\s+)?)*`;
const POLITE_ONLY = new RegExp(String.raw`^${POLITE_LEAD}`, 'i');
const COMMAND = new RegExp(String.raw`^${POLITE_LEAD}(?:${VERBS})\s+\S`, 'i');
const LEADING_VERB = new RegExp(String.raw`^${POLITE_LEAD}(?:${VERBS})\b\s*`, 'i');
// "... for me please?", "... thanks!" in any order.
const TRAILING_POLITE = /(?:[\s,.!?]+(?:please|pls|for\s+me|thanks|thank\s+you|thx))*[\s.!?]*$/i;
const NAMES = NAVIGATION_ACTIONS.flatMap(({ names = [] }) => names)
  .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const QUESTION_WORD = /\b(?:what|who|whom|whose|when|where|why|how)\b/i;
const BARE_NAME = new RegExp(String.raw`^(?:my\s+)?(?:${NAMES})$`, 'i');

const NOUNS = 'dm|dms|chat|channel|ticket|profile|conversation';
const LEADING_FILLER = new RegExp(
  String.raw`^(?:(?:my|the|an?|with|to|for|of|up|direct message|${NOUNS})(?:\s+|$))+`,
  'i',
);
const TRAILING_NOUN = new RegExp(String.raw`(?:\s+(?:${NOUNS}|page))+$`, 'i');
const CHANNEL_NAME = /#[\w.-]+/;
const TICKET_KEY = /\b[a-z][a-z0-9]*-\d+\b/i;

const withoutTrailingPoliteness = (text: string): string =>
  text.replace(TRAILING_POLITE, '').trim();

/** Cheap check that keeps questions off the intent classifier. */
export function looksLikeCommand(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LENGTH || QUESTION_WORD.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > MAX_WORDS) return false;
  // A question mark only passes a polite request ("can you open ...?"), not a plain question.
  const polite =
    trimmed.match(POLITE_ONLY)?.[0] || /[a-z]/i.test(trimmed.match(TRAILING_POLITE)?.[0] ?? '');
  if (trimmed.endsWith('?') && !polite) return false;
  const core = withoutTrailingPoliteness(trimmed);
  return COMMAND.test(core) || BARE_NAME.test(core);
}

/** The name, `#channel` or ticket key a command is about; empty when it names none. */
export function extractTarget(entity: EntityKind, text: string): string {
  if (entity === 'ticket') return text.match(TICKET_KEY)?.[0].toUpperCase() ?? '';
  if (entity === 'channel') {
    const channel = text.match(CHANNEL_NAME)?.[0];
    if (channel) return channel;
  }
  return withoutTrailingPoliteness(text)
    .replace(LEADING_VERB, '')
    .replace(LEADING_FILLER, '')
    .replace(TRAILING_NOUN, '')
    .replace(/['’]s$/, '')
    .trim();
}
