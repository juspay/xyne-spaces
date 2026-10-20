import { NAVIGATION_ACTIONS, type EntityKind } from './catalog';

const MAX_WORDS = 12;
const MAX_LENGTH = 200;

const VERBS = String.raw`open|go ?to|show(?:\s+me)?|take\s+me\s+to|navigate\s+to|message|dm|chat\s+with|text|view|launch`;
const COMMAND = new RegExp(String.raw`^(?:please\s+)?(?:${VERBS})\s+\S`, 'i');
const LEADING_VERB = new RegExp(String.raw`^(?:please\s+)?(?:${VERBS})\b\s*`, 'i');
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

/** Cheap check that keeps questions off the intent classifier. */
export function looksLikeCommand(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith('?') || trimmed.length > MAX_LENGTH || QUESTION_WORD.test(trimmed)) {
    return false;
  }
  if (trimmed.split(/\s+/).length > MAX_WORDS) return false;
  return COMMAND.test(trimmed) || BARE_NAME.test(trimmed);
}

/** The name, `#channel` or ticket key a command is about; empty when it names none. */
export function extractTarget(entity: EntityKind, text: string): string {
  if (entity === 'ticket') return text.match(TICKET_KEY)?.[0].toUpperCase() ?? '';
  if (entity === 'channel') {
    const channel = text.match(CHANNEL_NAME)?.[0];
    if (channel) return channel;
  }
  return text
    .trim()
    .replace(LEADING_VERB, '')
    .replace(LEADING_FILLER, '')
    .replace(TRAILING_NOUN, '')
    .replace(/['’]s$/, '')
    .trim();
}
