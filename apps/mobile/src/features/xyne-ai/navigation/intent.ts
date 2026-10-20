const MAX_CHOICES = 5;

/** What `POST /assistant/route` answers. */
export type JevRoute =
  | { route: 'actions'; actionIds: string[]; confidence: number }
  | { route: 'ask_ai'; reason: string }
  | { route: 'unavailable' };

/** The actions of ours the classifier named, best first; ids it made up or repeated are dropped. */
export function knownActions<T>(response: JevRoute, known: ReadonlyMap<string, T>): T[] {
  return response.route === 'actions'
    ? [...new Set(response.actionIds)].flatMap(id => known.get(id) ?? [])
    : [];
}

export type Resolution<T> =
  { kind: 'one'; match: T } | { kind: 'many'; matches: T[] } | { kind: 'none' };

/** One strong match opens directly; an exact name beats look-alikes; anything else is a choice. */
export function resolve<T extends { name: string }>(target: string, matches: T[]): Resolution<T> {
  const wanted = target.replace(/^#/, '').toLowerCase();
  const exact = matches.filter(({ name }) => name.replace(/^#/, '').toLowerCase() === wanted);
  const [only] = exact.length === 1 ? exact : matches.length === 1 ? matches : [];
  if (only) return { kind: 'one', match: only };
  return matches.length > 0
    ? { kind: 'many', matches: matches.slice(0, MAX_CHOICES) }
    : { kind: 'none' };
}
