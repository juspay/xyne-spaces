import { MAKES_SOMETHING } from './constants';
import { normalise } from './history';
import { ASKS_HERE, coreName } from './names';

/** Where a control lives: the page's own content (a channel's tabs), or the app's navigation. */
export type Scope = 'page' | 'app';

/** Areas (data-track-category) that are the app's navigation, not the page's content. */
export const APP_AREAS: ReadonlySet<string> = new Set([
  'app sidebar',
  'chat sidebar',
  'app navigator',
]);

const IN = '(?:in|inside|within|on|of|from)';
/** "my canvas", "all canvases", "the tickets page": the app's own. */
const ASKS_APP = /\b(?:my|all|every)\b|\b(?:page|section)\b/i;

/** The scope the request names, if it names one. */
export function scopeAsked(request: string): Scope | undefined {
  if (ASKS_HERE.test(request)) return 'page';
  return ASKS_APP.test(request) ? 'app' : undefined;
}

/** "… in the general channel", "… inside #general", "… in the dm with Om". */
const IN_NAMED_PLACE = new RegExp(
  `^(.+?)\\s+${IN}\\s+(?:the\\s+)?(?:#([\\p{L}\\p{N}_-]+)|(.+?)\\s+(channel|dm|conversation)|(dm|conversation|chat)\\s+with\\s+(.+))\\s*[.!?]?$`,
  'iu',
);
const NOT_A_NAME = /^(?:this|current|that|my|a|an|the)$/i;

/**
 * A step done in a place it names ("open tickets in the general channel"), as two: go to the
 * place, then do it there. Undefined when it names no place, or only the current one ("this
 * channel"), which `scopeAsked` covers.
 */
export function inNamedPlace(step: string): [string, string] | undefined {
  const match = IN_NAMED_PLACE.exec(step.trim());
  if (!match) return undefined;
  const [, thing = '', hashed, named, kind, withKind, person] = match;
  if (hashed) return [`open #${hashed}`, `${thing} here`];
  if (named && kind && !NOT_A_NAME.test(named.trim())) {
    return [`open ${named.trim()} ${kind}`, `${thing} here`];
  }
  if (withKind && person) return [`open ${withKind} with ${person.trim()}`, `${thing} here`];
  return undefined;
}

/** Asks for something to be made, so a "New …" or "Create …" control is what it wants. */
const WANTS_TO_MAKE =
  /\b(?:create|new|make|add|start|begin|compose|draft|write|set up|schedule|invite)\b/i;

/**
 * A button that makes something (a new canvas, a channel), not a way to what exists: by its text,
 * or by its track name when the text is only the thing ("＋ Canvas" is `Create_Canvas`).
 */
export const makesSomething = ({
  text,
  href,
  track = '',
}: {
  text: string;
  href?: string;
  track?: string;
}): boolean =>
  !href && (MAKES_SOMETHING.test(text.trim()) || MAKES_SOMETHING.test(normalise(track)));

/** Whether a control may answer the request: one that makes something only when asked to make. */
export const fitsRequest =
  (request: string) =>
  (item: { text: string; href?: string; track?: string }): boolean =>
    WANTS_TO_MAKE.test(request) || !makesSomething(item);

interface Scoped {
  id: string;
  text: string;
  href?: string;
  scope?: Scope;
}

/**
 * The same thing under the same name in the other scope: this channel's Canvas tab and My Canvas,
 * a channel's Tickets tab and the Tickets page. Two links to one place are one thing.
 */
export function rivalOf<O extends Scoped>(pick: O, offered: readonly O[]): O | undefined {
  if (!pick.scope) return undefined;
  const name = coreName(pick.text);
  return offered.find(
    option =>
      option.id !== pick.id &&
      !!option.scope &&
      option.scope !== pick.scope &&
      coreName(option.text) === name &&
      !(option.href && option.href === pick.href),
  );
}

/** A label's first note in brackets that says what the control is ("This channel's shared canvas"). */
const noteOf = (label: string): string | undefined =>
  [...label.matchAll(/\(([^)]+)\)/g)]
    .map(([, note = '']) => note.trim())
    .find(note => note && !/^(?:goes to |via |current$)/.test(note) && !APP_AREAS.has(note));

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Names for a "Did you mean…?" that tell the options apart: their text, and where two read the
 * same, what each is ("Canvas (this channel's shared canvas)") or where it is.
 */
export function distinctNames(options: readonly (Scoped & { label: string })[]): string[] {
  const counts = new Map<string, number>();
  options.forEach(({ text }) => counts.set(coreName(text), (counts.get(coreName(text)) ?? 0) + 1));
  return options.map(({ text, label, scope }) => {
    if ((counts.get(coreName(text)) ?? 0) < 2) return text;
    const note = noteOf(label);
    if (note) return `${text} (${lowerFirst(note)})`;
    return scope === 'page' ? `${text} on this page` : `${text} in the app`;
  });
}
