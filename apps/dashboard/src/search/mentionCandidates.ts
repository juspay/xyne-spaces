/**
 * What the search filters' typeaheads offer, and how a typed prefix is recognised: who `from:`,
 * `with:`, `assignee:` and `@` list, which channels `in:` and `#` list, what `mentions:`,
 * `priority:`, `board:` and the date prefixes show. The Cmd+K palette and the full-page search
 * box both read these, so the two offer the same candidates in the same order.
 */
import { TicketPriority, isDeskChannelType, type Channel } from '@xyne/shared';
import { ChipType } from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { ChannelCategory } from '../components/Chat/ChatDirectory/ChatDirectory.types';
import {
  getDMNames,
  getDMParticipantIdsToFetch,
  isDMChannel,
  isOneToOneDMChannel,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { filterChannelsBySearchableNames, rankUsersWithMfu } from '../utils/rankingUtils';
import type { DeskContact } from '../hooks/useDeskContacts';
import type { DeskPeople } from '../hooks/useDeskPeople';
import { DATE_RANGE_OPTIONS } from './filterRegistry';
import { resolveDateKeyword } from './filterModel';

/** Rows shown per `@`/`mentions:` section before "Show more", and the ceiling once expanded. */
export const MENTION_GROUP_PAGE = 5;
export const MENTION_GROUP_MAX = 20;

type UsersById = ReadonlyMap<string, { name: string; displayName?: string | null }>;

/** A channel as the typeaheads match it: its sidebar group and the names it answers to. */
export interface SearchableChannel {
  channel: Channel;
  category: ChannelCategory;
  searchableNames?: string[];
  searchNames?: string[];
}

/** A channel or DM row: the channel and the name it is listed under. */
export interface ChannelCandidate {
  channel: Channel;
  displayName: string;
}

/** A person row. Desk contacts carry their address as the id. */
export interface PersonCandidate {
  id: string;
  name: string;
  status?: string;
  email?: string;
  displayName?: string;
}

// ── Typed prefixes ─────────────────────────────────────────────────────────────────────────

/** Every prefix the typeaheads recognise, as typed (`in:#` / `in:@` are `in:` narrowed). */
export type TriggerText =
  | 'from:'
  | 'to:'
  | 'with:'
  | 'assignee:'
  | 'priority:'
  | 'board:'
  | 'on:'
  | 'after:'
  | 'before:'
  | 'mentions:'
  | 'in:'
  | 'in:#'
  | 'in:@'
  | '@'
  | '#';

/**
 * Rows per section a picker drawn whole (not virtualized) shows — the filter bar's From/In and the
 * Filters dialog's fields; typing narrows it. The In list can show 20 channels and 20 DMs.
 */
export const TYPEAHEAD_LIST_MAX = 20;

/** A prefix being typed: what kind of picker it opens, the prefix itself, and what follows it. */
export interface MentionTrigger {
  type: ChipType;
  text: TriggerText;
  query: string;
  /** Where the prefix starts in the text before the caret. */
  index: number;
}

/**
 * Gate the `priority:` dropdown: open only for an empty value or a prefix of a real
 * TicketPriority, so natural language ("High Priority: Refund rock") can't hijack it.
 */
export function priorityQueryHasMatch(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.values(TicketPriority).some(value => value.toLowerCase().startsWith(q));
}

/**
 * Where the last `prefix` (a word, any letter case) starts in `text`. The prefixes match case-
 * insensitively and must start a word, so the position must too: a plain `lastIndexOf` gave -1
 * for `From:` and found the `in:` inside `login:`.
 */
function lastPrefixIndex(text: string, prefix: string): number {
  // Prefixes are letters and a colon, so nothing needs escaping.
  const pattern = new RegExp(`\\b${prefix}`, 'gi');
  let index = -1;
  for (const match of text.matchAll(pattern)) index = match.index ?? index;
  return index;
}

/**
 * The prefix being typed at the caret, if any. Only the text before the caret counts, and the
 * first matching prefix in this order wins — so `from:Mam in:gen` is still a `from:` search for
 * "Mam in:gen": a filter is picked before the next one is typed.
 */
export function detectMentionTrigger(
  textBeforeCursor: string,
  { enableToTrigger }: { enableToTrigger: boolean },
): MentionTrigger | null {
  // Check for "from:", "to:", "with:", or "@" (user triggers).
  const fromMatch = textBeforeCursor.match(/\bfrom:\s*(.*)$/i);
  const toMatch = enableToTrigger ? textBeforeCursor.match(/\bto:\s*(.*)$/i) : null;
  const withMatch = textBeforeCursor.match(/\bwith:\s*(.*)$/i);
  // `(?:^|\s)@` ignores an embedded `@` (email/URL won't hijack mention mode); the query
  // allows spaces (so a demoted multi-word chip re-arms) but not a leading space, may be empty.
  const atMatch = textBeforeCursor.match(/(?:^|\s)@([^@\s][^@]*)?$/);

  const assigneeMatch = textBeforeCursor.match(/\bassignee:\s*(.*)$/i);

  // Check for "in:" or "#" (channel triggers)
  // Safe alongside the `@`/`#` triggers: both of those need a space or start-of-line
  // before the sigil, and here it follows a colon.
  const mentionsMatch = textBeforeCursor.match(/\bmentions:\s*(.*)$/i);
  const inMatch = textBeforeCursor.match(/\bin:\s*(.*)$/i);
  const hashMatch = textBeforeCursor.match(/(?:^|\s)#(\S*)$/);

  // `priority:` trigger. The prefix is case-sensitive, as it always was: `Priority: high` in
  // pasted text stays words; the value is matched case-insensitively (priorityQueryHasMatch).
  const priorityMatch = textBeforeCursor.match(/\bpriority:\s*(.*)$/);

  // Date triggers. The value is a partial date or a preset name, so anything is a
  // valid in-progress query — no gate like priorityQueryHasMatch.
  const boardMatch = textBeforeCursor.match(/\bboard:\s*(.*)$/i);
  const onMatch = textBeforeCursor.match(/\bon:\s*(.*)$/i);
  const afterMatch = textBeforeCursor.match(/\bafter:\s*(.*)$/i);
  const beforeMatch = textBeforeCursor.match(/\bbefore:\s*(.*)$/i);

  if (fromMatch) {
    return {
      type: ChipType.USER,
      text: 'from:',
      query: (fromMatch[1] || '').replace(/^@/, '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'from:'),
    };
  }
  if (toMatch) {
    return {
      type: ChipType.USER,
      text: 'to:',
      query: (toMatch[1] || '').replace(/^@/, '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'to:'),
    };
  }
  if (withMatch) {
    return {
      type: ChipType.USER,
      text: 'with:',
      query: (withMatch[1] || '').replace(/^@/, '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'with:'),
    };
  }
  if (assigneeMatch) {
    return {
      type: ChipType.USER,
      text: 'assignee:',
      query: (assigneeMatch[1] || '').replace(/^@/, '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'assignee:'),
    };
  }
  if (priorityMatch && priorityQueryHasMatch(priorityMatch[1] || '')) {
    return {
      type: ChipType.PRIORITY,
      text: 'priority:',
      query: (priorityMatch[1] || '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'priority:'),
    };
  }
  if (boardMatch) {
    return {
      type: ChipType.BOARD,
      text: 'board:',
      query: (boardMatch[1] || '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'board:'),
    };
  }
  if (onMatch) {
    return {
      type: ChipType.DATE,
      text: 'on:',
      query: (onMatch[1] || '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'on:'),
    };
  }
  if (afterMatch) {
    return {
      type: ChipType.DATE,
      text: 'after:',
      query: (afterMatch[1] || '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'after:'),
    };
  }
  if (beforeMatch) {
    return {
      type: ChipType.DATE,
      text: 'before:',
      query: (beforeMatch[1] || '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'before:'),
    };
  }
  if (mentionsMatch) {
    return {
      type: ChipType.MENTIONS,
      text: 'mentions:',
      query: (mentionsMatch[1] || '').replace(/^[@#]/, '').trim(),
      index: lastPrefixIndex(textBeforeCursor, 'mentions:'),
    };
  }
  if (inMatch) {
    const inQuery = (inMatch[1] || '').trim();
    // "in:@" compound trigger — search DMs (not users!) with in: prefix
    if (inQuery.startsWith('@')) {
      return {
        type: ChipType.CHANNEL,
        text: 'in:@',
        query: inQuery.substring(1).trim(),
        index: lastPrefixIndex(textBeforeCursor, 'in:'),
      };
    }
    // "in:#" compound trigger — search only channels
    if (inQuery.startsWith('#')) {
      return {
        type: ChipType.CHANNEL,
        text: 'in:#',
        query: inQuery.substring(1).trim(),
        index: lastPrefixIndex(textBeforeCursor, 'in:'),
      };
    }
    return {
      type: ChipType.CHANNEL,
      text: 'in:',
      query: inQuery.trim(),
      index: lastPrefixIndex(textBeforeCursor, 'in:'),
    };
  }
  if (atMatch) {
    // Strip trailing punctuation from mention query to avoid breaking
    // Fuse.js fuzzy search (e.g., typing "@john." should still match "john.doe")
    const rawQuery = atMatch[1] || '';
    const normalizedQuery = rawQuery.replace(/[.,!?:;)]*$/, '');
    // @channel / @here are reserved broadcast keywords, never users — skip user-mention mode
    // (first token, so "@channel test" counts too) so the message search runs, not a picker.
    if (!/^(channel|here)(\s|$)/i.test(normalizedQuery)) {
      return {
        type: ChipType.USER,
        text: '@',
        query: normalizedQuery,
        index: textBeforeCursor.lastIndexOf('@'),
      };
    }
    return null;
  }
  if (hashMatch) {
    return {
      type: ChipType.CHANNEL,
      text: '#',
      query: hashMatch[1] || '',
      index: textBeforeCursor.lastIndexOf('#'),
    };
  }
  return null;
}

// ── Channels ───────────────────────────────────────────────────────────────────────────────

/**
 * The Desk channel `from:`/`to:` are scoped to: the first `in:` channel, when it's a Desk one.
 * Later `in:` channels don't change it.
 */
export function deskScopeChannelId(
  firstInChannelId: string | undefined,
  findChannel: (id: string) => { type: Channel['type'] } | undefined,
): string | undefined {
  if (!firstInChannelId) return undefined;
  const channel = findChannel(firstInChannelId);
  return channel && isDeskChannelType(channel.type) ? firstInChannelId : undefined;
}

/** Every channel the typeaheads match against: starred, then channels, then DMs. */
export function buildSearchableChannels(
  {
    starred,
    channels,
    directMessages,
  }: { starred: Channel[]; channels: Channel[]; directMessages: Channel[] },
  currentUserId: string,
  usersById: UsersById,
): SearchableChannel[] {
  const result: SearchableChannel[] = [];

  // Add starred channels
  starred.forEach(channel => {
    const dmNames = getDMNames(channel, currentUserId, usersById);
    result.push({
      channel,
      category: ChannelCategory.STARRED,
      searchableNames: dmNames.display,
      searchNames: dmNames.search,
    });
  });

  // Add regular channels
  channels.forEach(channel => {
    result.push({
      channel,
      category: ChannelCategory.CHANNELS,
      searchableNames: [channel.name],
    });
  });

  // Add direct messages
  directMessages.forEach(channel => {
    const dmNames = getDMNames(channel, currentUserId, usersById);
    result.push({
      channel,
      category: ChannelCategory.DIRECT_MESSAGES,
      searchableNames: dmNames.display,
      searchNames: dmNames.search,
    });
  });

  return result;
}

/**
 * Regular channels (no DMs) for `in:`, `in:#` and `#`, matched as the plain search matches
 * them (fuzzy + hyphen-strip via searchChannels), then every query word must be in the name.
 * On the Desk tab only email channels; on any other tab every non-DM channel, email ones included.
 */
export function regularChannelCandidates(
  allChannels: SearchableChannel[],
  mentionSearchQuery: string,
  { deskTab }: { deskTab: boolean },
): ChannelCandidate[] {
  // Filter to only regular channels (no DMs), then scope by active tab
  const regularChannels = allChannels.filter(({ channel }) => {
    if (isDMChannel(channel.scopeType)) return false;
    if (deskTab) return isDeskChannelType(channel.type);
    return true;
  });

  // Apply search filtering
  const filtered = filterChannelsBySearchableNames(regularChannels, mentionSearchQuery, {
    excludeDMs: false, // Already filtered above
  });

  // Apply stricter filtering when there's a query
  const query = mentionSearchQuery.toLowerCase().trim();
  if (query) {
    const queryParts = query.split(/[,\s]+/).filter(Boolean);
    const strictlyFiltered = filtered.filter(({ channel }) => {
      const nameLower = channel.name.toLowerCase();
      return queryParts.every(part => nameLower.includes(part));
    });
    return strictlyFiltered.map(({ channel }) => ({ channel, displayName: channel.name }));
  }

  return filtered.map(({ channel }) => ({ channel, displayName: channel.name }));
}

/** A DM's name: its participants, "<you> (You)" for notes to yourself, else "Group Chat". */
export function dmDisplayName(
  channel: Channel,
  searchableNames: string[] | undefined,
  usersById: UsersById,
  currentUserId: string,
): string {
  if (!isDMChannel(channel.scopeType)) return channel.name;

  // For DMs, use participant names if available
  if (searchableNames && searchableNames.length > 0) {
    return searchableNames.join(', ');
  }

  // Fallback: try to get names from usersById
  const otherUserIds = getDMParticipantIdsToFetch(channel, currentUserId);

  // Check if this is a self-DM (only current user)
  const allParticipants = parseDMParticipantIds(channel);
  const isSelfDM = allParticipants.length === 1 && allParticipants[0] === currentUserId;

  if (isSelfDM) {
    // For self-DMs, show "You" or the user's own name
    const currentUser = usersById.get(currentUserId);
    const currentUserName = currentUser ? currentUser.displayName || currentUser.name : undefined;
    return currentUserName ? `${currentUserName} (You)` : 'You';
  }

  // Regular DM with others
  const otherNames = otherUserIds
    .map(id => {
      const u = usersById.get(id);
      return u ? u.displayName || u.name : undefined;
    })
    .filter((n): n is string => !!n);

  return otherNames.length > 0 ? otherNames.join(', ') : 'Group Chat';
}

/**
 * DMs and group DMs for `in:` and `in:@`, notes to yourself included. Every query word must
 * match a participant's name; DMs whose participants can't be named are left out.
 */
export function dmCandidates(
  allChannels: SearchableChannel[],
  mentionSearchQuery: string,
  currentUserId: string,
  usersById: UsersById,
): ChannelCandidate[] {
  // Filter to only DM channels
  const dmChannels = allChannels.filter(({ channel }) => isDMChannel(channel.scopeType));

  // Apply search filtering
  const filtered = filterChannelsBySearchableNames(dmChannels, mentionSearchQuery, {
    excludeDMs: false,
  });

  // Apply stricter filtering when there's a query
  const query = mentionSearchQuery.toLowerCase().trim();
  if (query) {
    const queryParts = query.split(/[,\s]+/).filter(Boolean);
    const strictlyFiltered = filtered.filter(({ channel, searchableNames }) => {
      // Check if this is a self-DM
      const allParticipants = parseDMParticipantIds(channel);
      const isSelfDM = allParticipants.length === 1 && allParticipants[0] === currentUserId;

      if (isSelfDM) {
        // For self-DMs, check if query matches current user's name or "you"
        const currentUserName = usersById.get(currentUserId)?.name?.toLowerCase() || '';
        const selfDMNames = ['you', currentUserName].filter(Boolean);
        return queryParts.every(part => selfDMNames.some(name => name.includes(part)));
      }

      // Get names to check: use searchableNames or fallback to usersById lookup
      const namesToCheck =
        searchableNames && searchableNames.length > 0
          ? searchableNames
          : getDMParticipantIdsToFetch(channel, currentUserId)
              .map(id => usersById.get(id)?.name)
              .filter((n): n is string => !!n);

      if (namesToCheck.length === 0) return false;

      const namesLower = namesToCheck.map(n => n.toLowerCase());
      // All query parts must match at least one participant name
      return queryParts.every(part => namesLower.some(name => name.includes(part)));
    });

    // Map to display format, filtering out DMs with no resolvable names
    return strictlyFiltered
      .map(({ channel, searchableNames }) => {
        const displayName = dmDisplayName(channel, searchableNames, usersById, currentUserId);
        // Only include if we have actual participant names
        if (displayName === 'Group Chat') {
          return null;
        }
        return { channel, displayName };
      })
      .filter((item): item is ChannelCandidate => item !== null);
  }

  // No query: show all DMs including self-DMs (with proper display names)
  return filtered
    .map(({ channel, searchableNames }) => {
      const displayName = dmDisplayName(channel, searchableNames, usersById, currentUserId);
      // Only include if we have actual participant names
      if (displayName === 'Group Chat') {
        return null;
      }
      return { channel, displayName };
    })
    .filter((item): item is ChannelCandidate => item !== null);
}

// ── People ─────────────────────────────────────────────────────────────────────────────────

/**
 * User ids the current user has a 1:1 DM with → recency index (0 = first DM in
 * `directMessages`, the recency-ordered list the empty DIRECT MESSAGES section also shows).
 * `rankUsers` uses it both as a "frequent contact" signal and as a tie-breaker, so the
 * `from:` typeahead's empty state mirrors the plain-search DM ordering.
 */
export function buildDmContactRecency(
  directMessages: Channel[],
  currentUserId: string,
): Map<string, number> {
  const map = new Map<string, number>();
  directMessages.forEach(channel => {
    if (isOneToOneDMChannel(channel.scopeType)) {
      const participants = parseDMParticipantIds(channel);
      const otherUserId = participants.find(id => id !== currentUserId);
      if (otherUserId && !map.has(otherUserId)) map.set(otherUserId, map.size);
    }
  });
  return map;
}

/**
 * People for the user prefixes, most-used first. `useUserSearch` slices to its limit *before*
 * ranking, so a frequently-used person can be dropped from `matches` entirely;
 * `rankUsersWithMfu` recovers MFU-weighted matches from `allUsers` so they float back up.
 */
export function rankedPeopleCandidates<
  T extends {
    id: string;
    name: string;
    status?: string | null;
    displayName?: string | null;
    email?: string;
  },
>(
  matches: T[],
  allUsers: T[],
  mentionSearchQuery: string,
  dmContactRecency: Map<string, number>,
): PersonCandidate[] {
  return rankUsersWithMfu(matches, allUsers, mentionSearchQuery, dmContactRecency).map(user => ({
    id: user.id,
    name: user.name,
    ...(user.status ? { status: user.status } : {}),
    ...(user.displayName && { displayName: user.displayName }),
    ...(user.email && { email: user.email }),
  }));
}

/**
 * In a Desk channel, `from:`/`to:` offer synced mailbox contacts instead of people (id = email),
 * so the chip carries an address for the mail from/to filter. A typed address no one has used
 * yet is offered first.
 */
export function deskPeopleCandidates(
  mentionSearchQuery: string,
  trigger: 'from:' | 'to:',
  deskPeople: DeskPeople,
  deskContacts: DeskContact[],
  limit: number,
): PersonCandidate[] {
  const raw = mentionSearchQuery.trim();
  const q = raw.toLowerCase();
  const deskPool = trigger === 'to:' ? deskPeople.recipients : deskPeople.senders;
  const byEmail = new Map<string, { email: string; name: string | null }>();
  for (const p of deskPool) {
    const e = p.email.toLowerCase();
    if (!byEmail.has(e)) byEmail.set(e, { email: p.email, name: p.name });
  }
  for (const c of deskContacts) {
    const e = c.email.toLowerCase();
    const existing = byEmail.get(e);
    if (!existing) byEmail.set(e, { email: c.email, name: c.name });
    else if (!existing.name && c.name) existing.name = c.name;
  }
  const pool = Array.from(byEmail.values());
  const matches = q
    ? pool.filter(
        p => p.email.toLowerCase().includes(q) || (p.name?.toLowerCase().includes(q) ?? false),
      )
    : pool;
  const items: PersonCandidate[] = matches.slice(0, limit).map(p => ({
    id: p.email,
    name: p.name || p.email,
    email: p.email,
  }));
  const looksLikeEmail = /\S+@\S+\.\S+/.test(raw);
  const exactMatch = items.some(i => i.email?.toLowerCase() === q);
  if (looksLikeEmail && !exactMatch) {
    items.unshift({ id: raw, name: raw, email: raw });
  }
  return items;
}

// ── Values ─────────────────────────────────────────────────────────────────────────────────

/**
 * Priority typeahead — the closed TicketPriority enum, prefix-filtered by the query. `id` is the
 * canonical uppercase value (wire/backend); `name` is the capitalized dropdown label.
 */
export function priorityCandidates(
  mentionSearchQuery: string,
): Array<{ id: string; name: string }> {
  const query = mentionSearchQuery.trim().toLowerCase();
  return Object.values(TicketPriority)
    .map(value => ({ id: value, name: value.charAt(0) + value.slice(1).toLowerCase() }))
    .filter(({ id }) => (query ? id.toLowerCase().startsWith(query) : true));
}

/** Board candidates, filtered by name. The chip carries the id the backend matches on. */
export function boardCandidates(
  boards: ReadonlyArray<{ id: string; name: string }>,
  mentionSearchQuery: string,
): Array<{ id: string; name: string }> {
  const query = mentionSearchQuery.trim().toLowerCase();
  return boards
    .filter(b => (query ? b.name?.toLowerCase().includes(query) : true))
    .slice(0, 20)
    .map(b => ({ id: b.id, name: b.name }));
}

/**
 * Date candidates: the presets, plus whatever the user has typed if it already looks like a
 * date. A preset carries its *keyword*, not the window it resolves to: "last 7 days" means
 * from whenever the search runs, and freezing it to today's dates would quietly go stale in a
 * restored search. Only presets we can resolve are offered, so a chip never stands for a window
 * the backend and the UI would compute differently.
 */
export function dateCandidates(mentionSearchQuery: string): Array<{ id: string; name: string }> {
  const query = mentionSearchQuery.trim().toLowerCase();
  const presets = DATE_RANGE_OPTIONS.filter(opt => opt.value && resolveDateKeyword(opt.value)).map(
    opt => ({ id: opt.value, name: opt.label }),
  );
  // A typed date is always offered first, so an exact day never needs a preset.
  const typed = /^\d{4}-\d{2}-\d{2}$/.test(query) ? [{ id: query, name: query }] : [];
  return [...typed, ...presets.filter(o => (query ? o.name.toLowerCase().includes(query) : true))];
}
