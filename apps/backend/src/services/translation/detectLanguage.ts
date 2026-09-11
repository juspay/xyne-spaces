import { franc } from 'franc';
import { fromFranc6393, toFranc6393 } from './languageCodes';

/**
 * Detects which of `candidateIso6391` the text is actually written in.
 *
 * Restricting `franc` to the languages present in the room (rather than all ~200 it
 * knows) meaningfully improves accuracy on short chat messages, which is franc's known
 * weak spot — narrowing the candidate space removes every unlikely language from
 * contention instead of asking it to rank all of them.
 *
 * Returns null when franc can't decide (e.g. "ok", a very short message) — callers
 * should fall back to treating the message as needing no translation rather than
 * guessing a source language.
 */
export function detectSourceLanguage(text: string, candidateIso6391: string[]): string | null {
  const only = candidateIso6391.map(toFranc6393).filter((c): c is string => Boolean(c));
  if (only.length === 0) return null;

  const detected = franc(text, { only, minLength: 1 });
  if (detected === 'und') return null;

  return fromFranc6393(detected) ?? null;
}
