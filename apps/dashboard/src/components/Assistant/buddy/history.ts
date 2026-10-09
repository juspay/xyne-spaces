import type { MenuItem } from './paths';

// What Buddy heard and did lately: so it can notice a request repeated because the last try did not
// help, and remember which control the user said yes to.

/** One request and what came of it. */
export interface Turn {
  request: string;
  /** Where the user was when it was heard. */
  page: string;
  reply: string;
  /** The control last used for it, if one was. */
  used?: { key: string; text: string };
  outcome: 'clicked' | 'pointed' | 'asked' | 'none';
}

/** Turns kept for context. */
const KEPT = 3;
/** Requests whose "yes" is remembered, per workspace. */
const REMEMBERED = 50;

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

/** A request heard on `page`, what Buddy said, the control it last used, and if it asked. */
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

/** The latest turns, newest last. */
export const remember = (turns: readonly Turn[], turn: Turn): Turn[] =>
  [...turns, turn].slice(-KEPT);

/** The turns just before this request that were the same request, newest first. */
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
 * The controls already tried for a request said again right after Buddy used one: it did not
 * help, so they are left out this time. After a "Did you mean…?" the repeat is a yes instead.
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

/** Where choices are kept: localStorage in the browser. */
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Which control the user said yes to for a request, kept in `store` (which may throw). */
export function choices(
  storageKey: string,
  store: () => Store,
): {
  recall(request: string): string | undefined;
  keep(request: string, key: string): void;
  forget(request: string): void;
} {
  let saved: Map<string, string> | undefined;
  const load = (): Map<string, string> => {
    if (saved) return saved;
    try {
      saved = new Map(JSON.parse(store().getItem(storageKey) ?? '[]') as [string, string][]);
    } catch {
      saved = new Map();
    }
    return saved;
  };
  const save = (): void => {
    try {
      store().setItem(storageKey, JSON.stringify([...load()]));
    } catch {
      // Not kept past this session (private mode, full storage): it still works for now.
    }
  };
  return {
    recall: request => load().get(normalise(request)),
    keep: (request, key): void => {
      const map = load();
      map.delete(normalise(request));
      map.set(normalise(request), key);
      [...map.keys()].slice(0, -REMEMBERED).forEach(old => map.delete(old));
      save();
    },
    forget: (request): void => {
      if (load().delete(normalise(request))) save();
    },
  };
}
