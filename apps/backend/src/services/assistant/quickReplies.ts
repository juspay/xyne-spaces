import type { TurnEvent } from '@xyne/shared/assistant';
import type { OpenQuestion } from './session';

/**
 * Replies that need no model: a button tap, "yes", "no", "cancel", a number, or
 * an option's own label. They are exact, instant, and never misread. Anything else — or a
 * short word that does not answer the question on screen — goes to the intent model.
 */
export type QuickReply =
  | { kind: 'event'; event: TurnEvent }
  /** The user picked one of the actions offered by "Did you mean …?". */
  | { kind: 'pick-action'; action: string };

const YES = words('yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirm|please do');
const NO = words("no|nope|no thanks|not now|skip|none|nobody|no one|done|that's all|thats all");
const CANCEL = words('cancel|never mind|nevermind|forget it|stop|abort');

const ORDINALS = words('first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth');
const NUMBERS = words('one|two|three|four|five|six|seven|eight|nine|ten');

/** A button tap, answered against the question it belongs to. */
export function quickChoice(optionId: string, question: OpenQuestion | null): QuickReply | null {
  if (!question) return null;
  if (question.kind === 'preview') {
    if (optionId === 'yes') return event({ type: 'yes' });
    if (optionId === 'no') return event({ type: 'no' });
    return null;
  }
  if (!question.options.some((option) => option.id === optionId)) return null;
  return question.kind === 'action'
    ? { kind: 'pick-action', action: optionId }
    : { kind: 'event', event: { type: 'choose', optionId } };
}

/** Typed or spoken words that are a complete answer on their own. */
export function quickText(text: string, question: OpenQuestion | null): QuickReply | null {
  const words = normalize(text);
  if (CANCEL.includes(words)) return event({ type: 'cancel' });
  if (!question) return null;

  // An option on screen wins over yes/no, so an option labelled "None" is picked, not read as "no".
  if (question.kind !== 'preview') {
    const byLabel = question.options.find((option) => normalize(option.label) === words);
    const byNumber = question.options[optionNumber(words) - 1];
    const option = byLabel ?? byNumber;
    if (option) return quickChoice(option.id, question);
  }
  if (question.kind === 'action') return null;
  if (YES.includes(words)) return event({ type: 'yes' });
  if (NO.includes(words)) return event({ type: 'no' });
  return null;
}

function words(list: string): string[] {
  return list.split('|');
}

function event(turnEvent: TurnEvent): QuickReply {
  return { kind: 'event', event: turnEvent };
}

/** "The second one", "number 2", "option two", "2" → 2. Anything else → 0. */
function optionNumber(words: string): number {
  const match =
    /^(?:(?:open|choose|select|pick|show|go to|take me to)\s+)?(?:the\s+|number\s+|option\s+)?(\w+)(?:\s+one)?$/.exec(
      words
    );
  const token = match?.[1] ?? '';
  if (/^\d+(?:st|nd|rd|th)?$/.test(token)) return Number.parseInt(token, 10);
  return Math.max(ORDINALS.indexOf(token), NUMBERS.indexOf(token)) + 1;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.,!?]+/g, ' ')
    .replace(/^(?:ok(?:ay)?|please|um+|uh+)\s+(?=\S)/, '')
    .replace(/\s+(?:please|thanks|thank you)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
