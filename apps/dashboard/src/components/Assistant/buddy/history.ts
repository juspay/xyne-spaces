import { MAKES_SOMETHING, OPENS_SOMETHING } from './constants';
import type { MenuItem } from './paths';

export interface Turn {
  request: string;
  /** The page the turn left the user on. */
  page: string;
  /** `reopens`: it only opens something (a form, dialog or menu) the user may since have closed. */
  used?: { key: string; text: string; reopens: boolean };
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

const reopens = ({ href, opens, text, toggles }: MenuItem): boolean =>
  !href && !toggles && (!!opens || MAKES_SOMETHING.test(text) || OPENS_SOMETHING.test(text));

export function turnOf(
  request: string,
  page: string,
  used: MenuItem | undefined,
  asked: boolean,
): Turn {
  const outcome = asked ? 'asked' : used?.use === 'point' ? 'pointed' : used ? 'clicked' : 'none';
  return {
    request,
    page,
    ...(used && { used: { key: controlKey(used), text: used.text, reopens: reopens(used) } }),
    outcome,
  };
}

export const remember = (turns: readonly Turn[], turn: Turn): Turn[] =>
  [...turns, turn].slice(-KEPT);

/** The latest turns that said the same, unless the user has moved on from where the last left them. */
const repeats = (turns: readonly Turn[], request: string, page: string): Turn[] => {
  if (turns.at(-1)?.page !== page) return [];
  const said = normalise(request);
  const same: Turn[] = [];
  for (const turn of [...turns].reverse()) {
    if (normalise(turn.request) !== said) break;
    same.push(turn);
  }
  return same;
};

/**
 * Controls already used for a request repeated right after, so they are left out: a link led
 * somewhere else than meant, a toggle would undo itself. One that only opens a form or menu is
 * used again, as the user would once they closed it; a turn that only asked used nothing.
 */
export function tried(turns: readonly Turn[], request: string, page: string): Set<string> {
  const same = repeats(turns, request, page);
  return new Set(same.flatMap(turn => (turn.used && !turn.used.reopens ? [turn.used.key] : [])));
}

/** The same request has used the same control twice in a row: trying again would loop. */
export function looping(turns: readonly Turn[], request: string, page: string): Turn | undefined {
  const [last, before] = repeats(turns, request, page);
  return last?.used && !last.used.reopens && before?.used?.key === last.used.key ? last : undefined;
}
