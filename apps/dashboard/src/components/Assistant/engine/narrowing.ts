import type { FieldKind } from '../actions/action';
import type { DialogueEvent, EngineState } from './dialogue';
import { channelNamed, resolve, type Directory, type Resolution } from './resolve';

// The words that bring in who or where a list is narrowed to; a date needs none.
const NARROWED_BY: Readonly<Record<string, FieldKind>> = {
  in: 'channel',
  from: 'person',
  with: 'person',
  by: 'person',
};
// Said around a narrowing without adding to it.
const NARROWING_LEAD = new Set(
  `ok okay no nah actually and also just only now then so maybe the one ones messages
  it it's its was`.split(/\s+/),
);
const NARROWING_TAIL = new Set('one ones only please instead then'.split(' '));
// The longest date keyword, in words: "last 24 hours".
const MAX_DATE_WORDS = 3;

type Part = { kind: FieldKind; from: number; to: number; found: Resolution | null };

const wordsOf = (text: string): string[] =>
  text
    .replace(/[,.!?;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** The list on screen narrowed by people, channels and dates found exactly; else null, for Jev. */
export function narrowing(
  dialogue: EngineState,
  text: string,
  directory: Directory,
): DialogueEvent | null {
  const words = wordsOf(text);
  const word = (at: number): string => (words[at] ?? '').toLowerCase();
  const said = (from: number, to: number): string => words.slice(from, to).join(' ');
  let start = 0;
  let end = words.length;
  while (start < end && NARROWING_LEAD.has(word(start))) start += 1;
  // "Open with Tom" narrows by Tom; "open #ops" may mean the channel itself, so Jev reads it.
  if (word(start) === 'open' && NARROWED_BY[word(start + 1)]) start += 1;
  while (end > start && NARROWING_TAIL.has(word(end - 1))) end -= 1;

  // Where the date keyword starting at `at` ends; `at` itself when none starts there.
  const dateEnd = (at: number): number => {
    for (let to = Math.min(end, at + MAX_DATE_WORDS); to > at; to -= 1) {
      if (resolve('date', said(at, to), directory)?.kind === 'one') return to;
    }
    return at;
  };
  const dated = (from: number, to: number): Part => ({
    kind: 'date',
    from,
    to,
    found: resolve('date', said(from, to), directory),
  });
  const marked = (kind: FieldKind, from: number, to: number): Part => ({
    kind,
    from,
    to,
    found: to > from ? resolve(kind, said(from, to), directory, true) : null,
  });
  // Bare words count only as a channel said as one ("ops channel", "#ops"), or named exactly and
  // not already the topic: alone they may as well be the topic.
  const bare = (from: number, to: number): Part => {
    const named = said(from, to);
    if (/^#|\bchannel$/i.test(named)) {
      return { kind: 'channel', from, to, found: resolve('channel', named, directory, true) };
    }
    const again = Object.values(dialogue.values).some(value =>
      value?.toLowerCase().includes(named.toLowerCase()),
    );
    const pick = again ? null : channelNamed(named, directory);
    return { kind: 'channel', from, to, found: pick && { kind: 'one', pick } };
  };
  const part = (at: number): Part => {
    const kind = NARROWED_BY[word(at)];
    const from = kind ? at + 1 : at;
    const dateTo = dateEnd(from);
    if (dateTo > from) return dated(from, dateTo);
    let to = from;
    while (to < end && !NARROWED_BY[word(to)] && dateEnd(to) === to) to += 1;
    return kind ? marked(kind, from, to) : bare(from, to);
  };

  const values: Record<string, string> = {};
  const resolutions: Record<string, Resolution> = {};
  for (let at = start; at < end; ) {
    const { kind, from, to, found } = part(at);
    const field = Object.entries(dialogue.action.fields).find(
      ([, definition]) => definition.kind === kind,
    )?.[0];
    // A field the search does not take, or one said twice, is for Jev.
    if (!field || field in values || !found || found.kind === 'none') return null;
    values[field] = said(from, to);
    resolutions[field] = found;
    at = to;
  }
  return Object.keys(values).length > 0 ? { type: 'fields', values, resolutions } : null;
}
