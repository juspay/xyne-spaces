import type { OnChangeStateEvent } from 'react-native-enriched';

import type { ChatInputSelection } from '../input-composer.types';

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

const sameEntries = (
  a: object,
  b: object,
  same: (left: unknown, right: unknown) => boolean,
): boolean => {
  const aEntries: [string, unknown][] = Object.entries(a);
  const bValues = new Map<string, unknown>(Object.entries(b));
  return (
    aEntries.length === bValues.size &&
    aEntries.every(([key, value]) => bValues.has(key) && same(value, bValues.get(key)))
  );
};

const sameStyle = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) ||
  (isObject(left) && isObject(right) && sameEntries(left, right, Object.is));

/** Same caret and selected text, so a repeat selection event changes nothing a reader sees. */
export const isSameSelection = (
  a: ChatInputSelection | null,
  b: ChatInputSelection | null,
): boolean =>
  a === b ||
  (a !== null && b !== null && a.start === b.start && a.end === b.end && a.text === b.text);

/** Every style's flags (active / conflicting / blocking) match. */
export const isSameStyleState = (
  a: OnChangeStateEvent | null,
  b: OnChangeStateEvent | null,
): boolean => a === b || (a !== null && b !== null && sameEntries(a, b, sameStyle));
