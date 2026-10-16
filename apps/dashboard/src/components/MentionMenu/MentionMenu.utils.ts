import { format } from 'date-fns';
import type { Channel, MentionResult } from '@xyne/shared';
import type { TabType } from '../Chat/ChatDirectory/ChannelCommandMenu.types';
import type { DisplaySearchResult } from '../../types/search';

// Pure helpers for the @ menu. Nothing here touches the DOM, so the node-env
// unit tests can import it; the React side lives in MentionMenu.tsx.

// ── Types ───────────────────────────────────────────────────────────────────

/** A tab of the all-context view. 'all' is the mixed view (recent people and channels before anything is typed). */
export type MentionSection =
  | 'all'
  | 'people'
  | 'channels'
  | 'messages'
  | 'files'
  | 'canvas'
  | 'tickets'
  | 'apps';

/** The seven tabs of the reference, in order. The composer appends 'apps' (artifact apps). */
export const MENTION_SECTIONS: readonly MentionSection[] = [
  'all',
  'people',
  'channels',
  'messages',
  'files',
  'canvas',
  'tickets',
];

/** One selectable row. `id` is unique across the rows of one render (it keys the row). */
export type MentionRow =
  | { type: 'person'; id: string; person: MentionResult }
  | { type: 'channel'; id: string; channel: Channel; displayName: string }
  | { type: 'result'; id: string; result: DisplaySearchResult }
  | { type: 'app'; id: string; app: { id: string; title: string }; subtitle: string };

/** A headed run of rows in the All tab. */
export interface MentionGroup {
  section: MentionSection;
  rows: MentionRow[];
}

// ── Sections ────────────────────────────────────────────────────────────────

export const SECTION_LABELS: Record<MentionSection, string> = {
  all: 'All',
  people: 'People',
  channels: 'Channels',
  messages: 'Messages',
  files: 'Files',
  canvas: 'Canvas',
  tickets: 'Tickets',
  apps: 'Apps',
};

/** Artifact apps are not in the search index, so their tab is the menu's own. */
const SECTION_TABS: Record<MentionSection, TabType | null> = {
  all: 'all',
  people: 'users',
  channels: 'channels',
  messages: 'messages',
  files: 'attachments',
  canvas: 'canvas',
  tickets: 'tickets',
  apps: null,
};

/** The search hook's tab for a section; null for the menu's own (apps). */
export const sectionToTab = (section: MentionSection): TabType | null => SECTION_TABS[section];

/** Tabs whose rows only come from the search index — nothing to list until something is typed. */
export const REMOTE_SECTIONS: ReadonlySet<MentionSection> = new Set([
  'messages',
  'files',
  'canvas',
  'tickets',
]);

/** The tab the menu opens on: the requested one when offered, else the first. */
export function initialSection(
  requested: MentionSection,
  sections: readonly MentionSection[],
): MentionSection {
  return sections.includes(requested) ? requested : (sections[0] ?? requested);
}

/** The tab Tab / Shift+Tab moves to, wrapping. */
export function stepSection(
  sections: readonly MentionSection[],
  current: MentionSection,
  backwards: boolean,
): MentionSection {
  if (sections.length === 0) return current;
  const index = sections.indexOf(current);
  const step = backwards ? -1 : 1;
  // From a tab that isn't offered, forward lands on the first and back on the last.
  const from = index === -1 ? (backwards ? 0 : -1) : index;
  return sections[(from + step + sections.length) % sections.length]!;
}

// ── Text ────────────────────────────────────────────────────────────────────

const ENTITIES = new Map([
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
  ['&nbsp;', ' '],
]);

/**
 * Search text without its markup: `<hi>` highlights and HTML tags dropped,
 * the common entities decoded, whitespace collapsed. A regex rather than
 * DOMParser so it runs anywhere; `keepLines` keeps line breaks (the hover card
 * shows the message as written).
 */
export function plainText(html: string | null | undefined, keepLines = false): string {
  if (!html) return '';
  const text = html
    // Breaks and block ends separate words; inline tags (highlights) don't.
    .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|h[1-6]|blockquote|pre)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|quot|#39|apos|nbsp);/g, entity => ENTITIES.get(entity) ?? entity)
    // Last, so "&amp;lt;" reads "&lt;" rather than "<".
    .replace(/&amp;/g, '&');
  if (!keepLines) return text.replace(/\s+/g, ' ').trim();
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "27 Mar 2026" and "9:48 PM" for a search timestamp (epoch seconds or milliseconds); null when missing. */
export function messageTime(
  timestamp: number | null | undefined,
): { date: string; time: string } | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  // Epoch seconds are 10 digits until 2286; milliseconds are 13.
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  return { date: format(date, 'd MMM yyyy'), time: format(date, 'h:mm a') };
}

// ── Search results ──────────────────────────────────────────────────────────

/** The kinds of indexed result the menu lists. Calls are listed under Files. */
export type ResultKind = 'message' | 'file' | 'call' | 'canvas' | 'ticket';

const KIND_SECTION: Record<ResultKind, MentionSection> = {
  message: 'messages',
  file: 'files',
  call: 'files',
  canvas: 'canvas',
  ticket: 'tickets',
};

/**
 * What an indexed result is, or null for rows the menu never offers — the
 * same rule as the composer's `pickFromResult`: no Desk mail, no Desk / RCA
 * attachments, no collections (those come in through the "+" menu). People
 * and channels come from the local lists, not the index.
 */
export function resultKind(result: DisplaySearchResult): ResultKind | null {
  const ctx = result.searchContext;
  switch (result.type) {
    case 'conversation':
      return ctx?.subApp?.toUpperCase() === 'DESK' ? null : 'message';
    case 'ticket':
      return 'ticket';
    case 'attachment': {
      if (!resultTitle(result)) return null;
      const subApp = ctx?.subApp?.toUpperCase();
      if (subApp === 'CANVAS') return 'canvas';
      if (subApp === 'TRANSCRIPT') return 'call';
      if (subApp === 'DESK' || subApp === 'RCA') return null;
      return 'file';
    }
    default:
      return null;
  }
}

/** The text a result row shows: the message text, the file / canvas / call name, the ticket title. */
export function resultTitle(result: DisplaySearchResult): string {
  const ctx = result.searchContext;
  switch (result.type) {
    case 'conversation':
      return plainText(result.context) || plainText(result.title);
    case 'attachment':
      return plainText(ctx?.fileName) || plainText(result.title);
    case 'ticket':
      return plainText(result.title) || ctx?.xyneId || 'Ticket';
    default:
      return plainText(result.title);
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

export const personRow = (person: MentionResult): MentionRow => ({
  type: 'person',
  id: `person:${person.id}`,
  person,
});

export const channelRow = (channel: Channel, displayName: string): MentionRow => ({
  type: 'channel',
  id: `channel:${channel.id}`,
  channel,
  displayName,
});

export const resultRow = (result: DisplaySearchResult): MentionRow => ({
  type: 'result',
  id: `${result.type}:${result.id}`,
  result,
});

export const appRow = (app: { id: string; title: string }, subtitle: string): MentionRow => ({
  type: 'app',
  id: `app:${app.id}`,
  app,
  subtitle,
});

/** Rows with each id once (search can return the same hit in two buckets). */
export function uniqueRows(rows: readonly MentionRow[], seen = new Set<string>()): MentionRow[] {
  return rows.filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/** A single-kind tab's rows: the results of that kind, in search order. */
export function resultRowsFor(
  section: MentionSection,
  results: readonly DisplaySearchResult[],
): MentionRow[] {
  return uniqueRows(
    results.flatMap(result => {
      const kind = resultKind(result);
      return kind && KIND_SECTION[kind] === section ? [resultRow(result)] : [];
    }),
  );
}

/** How many of each local kind the All tab leads with. */
const ALL_RECENT_PEOPLE = 4;
const ALL_RECENT_CHANNELS = 8;
const ALL_MATCHED_PEOPLE = 3;
const ALL_MATCHED_CHANNELS = 3;
const ALL_RESULT_SECTIONS: readonly MentionSection[] = ['messages', 'files', 'canvas', 'tickets'];

/**
 * The All tab: before anything is typed, the people you talk to and your
 * recent channels; once a query is typed, the best few people and channels,
 * then what the index found, a heading per kind. Empty groups are left out.
 */
export function buildAllSections({
  people,
  channels,
  results,
  hasQuery,
}: {
  people: readonly MentionResult[];
  channels: ReadonlyArray<{ channel: Channel; displayName: string }>;
  results: readonly DisplaySearchResult[];
  hasQuery: boolean;
}): MentionGroup[] {
  const groups: MentionGroup[] = [
    {
      section: 'people',
      // Groups and @channel/@here are for a typed search, not the opening view.
      rows: (hasQuery ? people : people.filter(p => p.type === 'user'))
        .slice(0, hasQuery ? ALL_MATCHED_PEOPLE : ALL_RECENT_PEOPLE)
        .map(personRow),
    },
    {
      section: 'channels',
      rows: channels
        .slice(0, hasQuery ? ALL_MATCHED_CHANNELS : ALL_RECENT_CHANNELS)
        .map(({ channel, displayName }) => channelRow(channel, displayName)),
    },
    ...(hasQuery
      ? ALL_RESULT_SECTIONS.map(section => ({ section, rows: resultRowsFor(section, results) }))
      : []),
  ];
  // One id once across the whole tab, so every row keys once.
  const seen = new Set<string>();
  return groups
    .map(group => ({ ...group, rows: uniqueRows(group.rows, seen) }))
    .filter(group => group.rows.length > 0);
}

// ── People ──────────────────────────────────────────────────────────────────

/** A workspace user as the people sources hand them over. */
export interface PersonLike {
  id: string;
  name: string;
  displayName?: string | null | undefined;
  email?: string | null | undefined;
}

/** How many people the menu lists from its own source, and how many of them lead as recent DMs. */
export const PEOPLE_LIMIT = 25;
export const RECENT_PEOPLE = 8;

export const toMentionPerson = (user: PersonLike): MentionResult => ({
  id: user.id,
  name: user.displayName || user.name,
  type: 'user',
  ...(user.email ? { email: user.email } : {}),
});

/**
 * The menu's people list: with nothing typed, whoever you DM'd most recently,
 * then everyone else; with a query, the matches. Never yourself, each person
 * once.
 */
export function peopleSuggestions({
  recent,
  hits,
  selfId,
  hasQuery,
}: {
  /** DM partners, most recent first. */
  recent: readonly PersonLike[];
  /** The user search's matches (the first users when nothing is typed). */
  hits: readonly PersonLike[];
  selfId: string;
  hasQuery: boolean;
}): MentionResult[] {
  const seen = new Set<string>([selfId]);
  const out: PersonLike[] = [];
  const take = (list: readonly PersonLike[], limit: number): void => {
    for (const user of list) {
      if (out.length >= limit) return;
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      out.push(user);
    }
  };
  if (!hasQuery) take(recent, RECENT_PEOPLE);
  take(hits, PEOPLE_LIMIT);
  return out.map(toMentionPerson);
}
