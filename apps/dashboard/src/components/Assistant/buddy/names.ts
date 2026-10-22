import { normalise } from './history';

const PLACE = '(?:channel|dm|direct message|conversation|chat|thread)';
const IN = '(?:in|inside|within|on|of|from)';

/** "in this channel", "inside dm", "this channel's", "here": the page the user is on. */
export const ASKS_HERE = new RegExp(
  `\\b(?:${IN}\\s+(?:the\\s+|this\\s+|current\\s+)?${PLACE}|(?:this|current)\\s+${PLACE}(?:'s|s)?|here)\\b`,
  'i',
);

/** What a control is called, past the words that only say whose or how many ("My Canvas" → canvas). */
export const coreName = (text: string): string =>
  normalise(text)
    .replace(/^(?:my|all|your|the|open|go to|view|show)\s+/, '')
    .replace(/s$/, '');

/** The words that only say how or where ("open", "the", "in this channel", "my"), not what. */
const HOW_OR_WHERE = new RegExp(
  `${ASKS_HERE.source}|\\b(?:open|go to|take me to|navigate to|show|view|see|the|a|an|my|all|page|tab|section|channel|dm|conversation|please)\\b`,
  'gi',
);

/**
 * Whether the control is all the request asked for ("open canvas here" and the Canvas tab, "open
 * my canvas" and My Canvas, "open calls" and Calls): then it is done, with nothing more specific to
 * look for, and the reply needs no wait for the page it opens.
 */
export const namesAll = (request: string, text: string): boolean => {
  const asked = coreName(request.replace(HOW_OR_WHERE, ' '));
  return asked !== '' && asked === coreName(text);
};
