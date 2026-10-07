import type { AssistantRouteAction } from '.';

type FieldValues = Record<string, string>;

// How far the likeliest action must lead the next for that one to be dropped. On the tune split
// Jev's top was wrong with leads of up to 0.73 ("revoke the invite I sent to sam"), and right ones
// never led by more than 0.64 where a second was offered, so only a near-certain lead counts.
const LEAD_MARGIN = 0.75;

// Words that may sit inside an action's name as said: "send a message", "create a new channel".
const INSIDE_NAME = new Set('a an the this that new my some one'.split(' '));
// Words around a bare name that ask nothing more: "can you send a message please".
const AROUND_NAME = new Set(
  [
    'please pls can could would will you just i want to like need',
    'let me lets uh um ok okay so now hey',
  ]
    .join(' ')
    .split(' ')
);

const stem = (word: string): string => word.replace(/ies$/, 'y').replace(/s$/, '');
const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
const nameOf = (id: string): string[] => id.split('_').map(stem);

// Whether the words say the action's name in order, with only INSIDE_NAME words between.
const saysName = (words: string[], name: string[]): boolean =>
  words.some((word, start) => {
    if (word !== name[0]) return false;
    let next = 1;
    for (let at = start + 1; at < words.length && next < name.length; at += 1) {
      if (words[at] === name[next]) next += 1;
      else if (!INSIDE_NAME.has(words[at] ?? '')) return false;
    }
    return next === name.length;
  });

/** The one action whose own name the sentence says ("send a message"); none when not one. */
export function namedAction(text: string, actions: AssistantRouteAction[]): string | undefined {
  const words = wordsOf(text);
  const named = actions.filter((action) => saysName(words, nameOf(action.id)));
  return named.length === 1 ? named[0]?.id : undefined;
}

/** Whether the sentence is nothing but the action's name: "Send message.", "start a chat". */
export const isBareName = (text: string, id: string): boolean =>
  wordsOf(text)
    .filter((word) => !AROUND_NAME.has(word) && !INSIDE_NAME.has(word))
    .join(' ') === nameOf(id).join(' ');

// Actions the catalog tells apart in their "Not for" ("… (that is send_message)"): Jev mixes them up.
const refersTo = (action: AssistantRouteAction | undefined, id: string): boolean =>
  !!action?.description.includes(`that is ${id}`);

/**
 * The candidates once a clear choice is made among them: the action the sentence names drops the
 * actions confused with it, and a near-certain lead drops the rest. An action that read a value
 * the kept one has no field for holds more of the sentence ("start a chat and say hello"), so it
 * stays and the user is asked.
 */
export function clearCandidates(
  candidates: string[],
  {
    text,
    actions,
    values,
    probability,
  }: {
    text: string;
    actions: AssistantRouteAction[];
    values: Record<string, FieldValues>;
    probability: (id: string) => number;
  }
): string[] {
  const byId = (id: string) => actions.find((action) => action.id === id);
  const holdsMore = (other: string, kept: string): boolean =>
    Object.keys(values[other] ?? {}).some((field) => !byId(kept)?.fields?.[field]);
  // The candidates without those `drops` takes, `kept` first if it was not among them; as they
  // were when nothing is dropped.
  const without = (kept: string, drops: (id: string) => boolean): string[] => {
    const rest = candidates.filter((id) => id === kept || !drops(id) || holdsMore(id, kept));
    if (rest.length === candidates.length) return candidates;
    return rest.includes(kept) ? rest : [kept, ...rest];
  };

  // Only a request with something in it: the name alone ("revoke an invitation") is as likely a
  // wish to see the page.
  const named = namedAction(text, actions);
  if (named && values[named]) {
    const confused = (id: string): boolean =>
      id !== named && (refersTo(byId(id), named) || refersTo(byId(named), id));
    const kept = without(named, confused);
    if (kept !== candidates) return kept;
  }

  const [top, second] = candidates;
  if (!top || !second || probability(top) - probability(second) < LEAD_MARGIN) return candidates;
  return without(top, (id) => id !== top);
}
