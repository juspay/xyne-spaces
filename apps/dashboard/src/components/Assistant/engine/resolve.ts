import { ChannelScopeType, UserType, type Channel } from '@xyne/shared';
import type { User } from '@xyne/shared/machines';
import { normalizeChannelName } from '@xyne/shared/utils';
import { searchChannelsWithScores } from '../../../hooks/useChannels';
import { searchUsersWithScores } from '../../../hooks/useUsers';
import { isResolvableDateKeyword } from '../../../search/filterModel';
import type { FieldDefinition, FieldKind } from '../actions/action';
import { emailResolution } from './email';

/**
 * Turns the words a user said for a person, a channel or a date into the record they mean,
 * from what is already in the app. Pure: no model, no network, no store; the directory it looks in
 * is handed to it.
 */
// `thread` is set when it stands for one conversation in the channel `id`; `group` when it stands
// for several people, whose ids `id` joins so that a confirmation pins every one of them. `email`:
// a person's, so a reply naming it tells apart people who share a name.
export type Resolved = {
  id: string;
  label: string;
  thread?: string;
  group?: Resolved[];
  email?: string;
};

// `many`: every record that fits equally well, the likeliest first; only the first few are offered
// aloud, and a reply narrows the rest. `named`: the one name several people share, when it is one
// of several names said ("Sara" in "Sara and Rahul"). `guess`: none fits the words, but these
// have the first name said, so the user is asked whether one of them was meant.
export type Resolution =
  | { kind: 'one'; pick: Resolved }
  | { kind: 'many'; options: Resolved[]; named?: string; guess?: boolean }
  | { kind: 'none' };

// The conversation the user is looking at; `label` is how it is named to them, and `channel` how
// the channel alone is, when it is a thread in one.
export interface Here {
  channelId: string;
  conversationId?: string;
  label: string;
  channel?: string;
}

// Only what the user may pick: active people, and channels they can see, and where they are.
// `tagged`: people the user picked in the composer as @mention chips, named as the chip shows.
// `selfId`: the user, whom "me" stands for.
export interface Directory {
  people: User[];
  channels: Channel[];
  here?: Here | null;
  tagged?: readonly Resolved[];
  selfId?: string | null;
}

const NONE: Resolution = { kind: 'none' };
// Enough to count everyone who shares a name, so the user is told how many there are.
const MAX_CANDIDATES = 50;
// The most records offered to choose from: they are read aloud.
export const MAX_OPTIONS = 3;

// Scores are Fuse's (0 exact to 1 unrelated, lower is better) minus 10 when the name starts with
// the words and minus 5 when one of its words does. Those shifts are what set candidates apart:
// within a tier scores differ by less than Fuse's own threshold (0.3), between tiers by well over
// 1. So a gap of 1 is a different kind of match, and a smaller one is a tie.
const CLEAR_MARGIN = 1;

const lower = (text: string): string => text.trim().toLowerCase();

// The `exact` tests are tried in order, and the first that fits exactly one candidate settles it.
// Otherwise a clear lead settles it, unless `guess` is false: then the close ones are asked about,
// each as `toOption` has it.
function decide<T>(
  matches: { item: T; score: number }[],
  toResolved: (item: T) => Resolved,
  exact: ((item: T) => boolean)[],
  guess = true,
  toOption = toResolved,
): Resolution {
  const [top, second] = matches;
  if (!top) return NONE;
  for (const test of exact) {
    const [only, another] = matches.filter(({ item }) => test(item));
    if (only && !another) return { kind: 'one', pick: toResolved(only.item) };
  }
  if (guess && (!second || second.score - top.score >= CLEAR_MARGIN)) {
    return { kind: 'one', pick: toResolved(top.item) };
  }
  const close = matches.filter(({ score }) => score - top.score < CLEAR_MARGIN);
  return { kind: 'many', options: close.map(({ item }) => toOption(item)) };
}

const shownName = (user: User): string => user.displayName || user.name;

// Below this many letters a name that only starts with what was said is a guess: "Ai" is not Aisha.
const MIN_GUESS_LENGTH = 3;

// The product calls its assistant Xyne AI ("Ask Xyne AI"); in the directory it is the bot Ask AI.
const ASSISTANT_BOT = 'ask ai';
const ASSISTANT_NAMES = new Set(['xyne ai', 'xyne', 'ask xyne ai', 'the ai']);

// Said for a group, never for one person: "everyone in the company", "the whole team".
const EVERYONE =
  /^(?:every(?:one|body)|all|(?:the\s+)?(?:whole|entire)\s+\S+|the\s+(?:company|team|org|organi[sz]ation|workspace))\b/;

export const isEveryone = (words: string): boolean => EVERYONE.test(lower(words));

// Said for the user themself.
const SELF = new Set(['me', 'myself', 'mujhe']);

// Whether two first names differ by at most one letter, as speech to text spells a name: "Sarah"
// for Sara. Short names must be equal: "Al" is not Ali.
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < MIN_GUESS_LENGTH + 1 || Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  // One letter changed, added or dropped at `at`: the rest is then the same.
  return [
    a.slice(at + 1) === b.slice(at + 1),
    a.slice(at) === b.slice(at + 1),
    a.slice(at + 1) === b.slice(at),
  ].some(Boolean);
}

/**
 * A full name that fits no one, whose first name fits a few people: speech to text mishears
 * surnames ("Sara Ayan", "Sarah Pyer" for Sara Iyer). They are offered to choose from, never
 * picked, the closest first names first.
 */
function byFirstName(
  said: string,
  people: User[],
  toResolved: (user: User) => Resolved,
): Resolution {
  const [first = '', ...rest] = said.split(/\s+/);
  if (rest.length === 0) return NONE;
  const firstOf = (user: User): string => lower(shownName(user)).split(/\s+/)[0] ?? '';
  const near = people
    .filter(user => nearlySame(firstOf(user), first))
    .sort((a, b) => Number(firstOf(b) === first) - Number(firstOf(a) === first));
  const [closest] = near;
  if (!closest) return NONE;
  return {
    kind: 'many',
    options: near.map(toResolved),
    named: shownName(closest).split(/\s+/)[0] ?? first,
    guess: true,
  };
}

// `exact`: only people the words are a whole name or a whole word of a name of ("Tom" for Tom Lee),
// never a near match ("Tomm", "Tomas" for Tom).
function person(spoken: string, { people, tagged, selfId }: Directory, exact = false): Resolution {
  // "Ankit's message" names Ankit, and "@sarah" typed without picking her chip names Sarah.
  const words = spoken
    .trim()
    .replace(/^@/, '')
    .replace(/['’]s$/i, '');
  const said = lower(words);
  // A group is no one person, whoever's name it happens to match.
  if (isEveryone(said)) return NONE;
  // A chip names the very person picked, so it is never searched for by name.
  const chip = tagged?.find(({ label }) => lower(label) === said);
  if (chip) return { kind: 'one', pick: chip };
  const self = SELF.has(said) ? people.find(({ id }) => id === selfId) : undefined;
  if (self) return { kind: 'one', pick: { id: self.id, label: `${shownName(self)} (you)` } };
  const names = (user: User): string[] =>
    [user.displayName, user.name].flatMap(n => (n ? [lower(n)] : []));
  // Unless someone is called that: then they are the one meant.
  const assistant =
    ASSISTANT_NAMES.has(said) && !people.some(user => names(user).includes(said))
      ? people.find(user => user.userType === UserType.BOT && names(user).includes(ASSISTANT_BOT))
      : undefined;
  if (assistant) return { kind: 'one', pick: { id: assistant.id, label: shownName(assistant) } };
  const found = searchUsersWithScores(people, words, MAX_CANDIDATES);
  const matches = exact
    ? found.filter(({ item }) =>
        names(item).some(name => name.split(/\s+/).includes(said) || name === said),
      )
    : found;
  // Two people with one name are told apart by their email, so a reply naming one is unambiguous.
  const sameName = (user: User): boolean =>
    matches.filter(({ item }) => lower(shownName(item)) === lower(shownName(user))).length > 1;
  const toResolved = (user: User): Resolved => ({
    id: user.id,
    label: sameName(user) ? `${shownName(user)} (${user.email})` : shownName(user),
  });
  const toOption = (user: User): Resolved => ({ ...toResolved(user), email: user.email });
  const resolution = decide(
    matches,
    toResolved,
    [
      (user): boolean => names(user).includes(said),
      (user): boolean => names(user).some(name => name.split(/\s+/)[0] === said),
      // A whole word of the name: "AI" is Ask AI, though "Aisha" starts with it.
      (user): boolean => names(user).some(name => name.split(/\s+/).includes(said)),
    ],
    said.length >= MIN_GUESS_LENGTH,
    toOption,
  );
  // A full name settles on someone only when each word said starts a word of their name ("Priya
  // Sh"): a misheard surname ("Sarah Ayan" for Sara Iyer) is never picked, though it may lead.
  const heard = said.split(/\s+/);
  const covers = (user: User | undefined): boolean =>
    !!user &&
    names(user).some(name => {
      const parts = name.split(/\s+/);
      return heard.every(word => parts.some(part => part.startsWith(word)));
    });
  const doubtful =
    resolution.kind === 'one' &&
    heard.length > 1 &&
    !covers(people.find(({ id }) => id === resolution.pick.id));
  // Settled without Jev, only what was said exactly counts.
  if (exact || (resolution.kind !== 'none' && !doubtful)) return resolution;
  const offered = byFirstName(said, people, toOption);
  return offered.kind === 'none' ? resolution : offered;
}

// "Priya, Rahul and Sara": the names of several people, and how they are said back.
const NAMES_SPLIT = /\s*(?:,|&|\band\b|\baur\b)\s*/i;
const andList = (labels: string[]): string =>
  labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels.join('');

const groupOf = (picks: Resolved[]): Resolved => {
  const group = [...new Map(picks.map(pick => [pick.id, pick])).values()];
  const [only] = group;
  return group.length === 1 && only
    ? only
    : {
        id: group.map(({ id }) => id).join(','),
        label: andList(group.map(({ label }) => label)),
        group,
      };
};

/**
 * Several people, each name found as `person` finds one. One name that fits none leaves the whole
 * group unfound; names that fit several are chosen between as whole groups, the likeliest first,
 * so the card always names everyone the request is for. The user is in the group anyway, so "me"
 * among others adds no one.
 */
function people(words: string, directory: Directory, exact = false): Resolution {
  const names = words.split(NAMES_SPLIT).filter(name => name.trim());
  if (names.length < 2) return person(words, directory, exact);
  const found = names.map(name => person(name, directory, exact));
  const choices = found.flatMap(resolution =>
    resolution.kind === 'one'
      ? resolution.pick.id === directory.selfId
        ? []
        : [[resolution.pick]]
      : [resolution.kind === 'many' ? resolution.options : []],
  );
  if (choices.length === 0 || choices.some(options => options.length === 0)) return NONE;
  const groups = choices
    .reduce<
      Resolved[][]
    >((sofar, options) => sofar.flatMap(picks => options.map(option => [...picks, option])).slice(0, MAX_CANDIDATES), [[]])
    .map(groupOf);
  const [first] = groups;
  if (!first) return NONE;
  if (groups.length === 1) return { kind: 'one', pick: first };
  // One name shared by several people is what the question is about.
  const [shared, another] = names.filter((_, at) => found[at]?.kind === 'many');
  return { kind: 'many', options: groups, ...(shared && !another && { named: shared.trim() }) };
}

// Said for the conversation the user is in, which is also a channel just created: creating one
// opens it. "the particular thread", "everyone in the thread", "in it", and what may run on after
// it: "this thread and ask it…". A closed set of words: anything else is a channel's name.
const HERE =
  /^(?:everyone\s+)?(?:in\s+)?(?:it|here|(?:(?:the|this|that|same|particular|current|new)\s+)+(?:thread|channel|conversation)|the channel i just created)(?:\s+and\b.*)?$/;

// "This channel" with a thread open is the channel, not the thread.
function hereOf(current: Here | null | undefined, words: string): Resolution {
  if (!current) return NONE;
  const { channelId, conversationId, label, channel: name } = current;
  if (conversationId && /\bchannel\b/.test(words)) {
    return { kind: 'one', pick: { id: channelId, label: name ?? label } };
  }
  return {
    kind: 'one',
    pick: { id: channelId, label, ...(conversationId ? { thread: conversationId } : {}) },
  };
}

// "the #design channel" names the channel design.
const channelName = (words: string): string =>
  words
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/\s+channel$/i, '')
    .replace(/^#/, '');

const joinable = (channels: Channel[]): Channel[] =>
  channels.filter(c => c.scopeType === ChannelScopeType.DEFAULT && !c.isArchived);

const named = (name: string): ((c: Channel) => boolean) => {
  const said = lower(normalizeChannelName(name));
  return c => lower(normalizeChannelName(c.name)) === said;
};

// `exact`: only a channel of that very name, never a near match ("eng" for engineering).
function channel(words: string, { channels, here: current }: Directory, exact = false): Resolution {
  if (HERE.test(lower(words))) return hereOf(current, lower(words));
  const name = channelName(words);
  const found = searchChannelsWithScores(joinable(channels), name, MAX_CANDIDATES);
  return decide(
    exact ? found.filter(({ item }) => named(name)(item)) : found,
    c => ({ id: c.id, label: c.name }),
    [named(name)],
  );
}

/** The channel the words name exactly ("ops", "the #ops channel"), never a near match; or null. */
export function channelNamed(words: string, { channels }: Directory): Resolved | null {
  const found = joinable(channels).find(named(channelName(words)));
  return found ? { id: found.id, label: found.name } : null;
}

// The search page reads the keyword itself, so it travels as it is.
function date(words: string): Resolution {
  const keyword = lower(words).replace(/\s+/g, ' ');
  return isResolvableDateKeyword(keyword)
    ? { kind: 'one', pick: { id: keyword, label: keyword } }
    : NONE;
}

/**
 * What `words` means as a field of this kind; null for a kind that needs no resolving. `exact`:
 * only records named as said, for a sentence settled without Jev, which a near match must not be.
 */
export function resolve(
  kind: FieldKind,
  words: string,
  directory: Directory,
  exact = false,
): Resolution | null {
  switch (kind) {
    case 'person':
      return person(words, directory, exact);
    case 'people':
      return people(words, directory, exact);
    case 'channel':
      return channel(words, directory, exact);
    case 'date':
      return date(words);
    default:
      return null;
  }
}

/** What `words` means for this field: read as its `parse` says, else resolved by its kind. */
export const resolveField = (
  { kind, parse }: Pick<FieldDefinition, 'kind' | 'parse'>,
  words: string,
  directory: Directory,
  exact = false,
): Resolution | null =>
  parse === 'email' ? emailResolution(words) : resolve(kind, words, directory, exact);
