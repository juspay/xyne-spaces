import type { MenuItem } from './paths';

export interface Turn {
  request: string;
  page: string;
  reply: string;
  used?: { key: string; text: string };
  outcome: 'clicked' | 'pointed' | 'asked' | 'none';
}

const KEPT = 3;

/** The same control, wherever it is read: its track, text and where it goes. */
export const controlKey = ({
  track,
  text,
  href,
}: Pick<MenuItem, 'track' | 'text' | 'href'>): string => [track, text, href ?? ''].join('|');

/** The request as said, whatever the case, punctuation or spacing. */
export const normalise = (request: string): string =>
  request
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function turnOf(
  request: string,
  page: string,
  reply: string | null,
  used: MenuItem | undefined,
  asked: boolean,
): Turn {
  const outcome = asked ? 'asked' : used?.use === 'point' ? 'pointed' : used ? 'clicked' : 'none';
  return {
    request,
    page,
    reply: reply ?? 'handed to Ask AI',
    ...(used && { used: { key: controlKey(used), text: used.text } }),
    outcome,
  };
}

export const remember = (turns: readonly Turn[], turn: Turn): Turn[] =>
  [...turns, turn].slice(-KEPT);

const repeats = (turns: readonly Turn[], request: string): Turn[] => {
  const said = normalise(request);
  const same: Turn[] = [];
  for (const turn of [...turns].reverse()) {
    if (normalise(turn.request) !== said) break;
    same.push(turn);
  }
  return same;
};

/**
 * Controls already tried for a request repeated right after Buddy used one, so they are left out.
 * After a "Did you mean…?" the repeat is a yes instead.
 */
export function tried(turns: readonly Turn[], request: string): Set<string> {
  const same = repeats(turns, request);
  if (same[0]?.outcome === 'asked') return new Set();
  return new Set(same.flatMap(turn => (turn.used ? [turn.used.key] : [])));
}

/** The same request has used the same control twice in a row: trying again would loop. */
export function looping(turns: readonly Turn[], request: string): Turn | undefined {
  const [last, before] = repeats(turns, request);
  return last?.used && before?.used?.key === last.used.key ? last : undefined;
}
