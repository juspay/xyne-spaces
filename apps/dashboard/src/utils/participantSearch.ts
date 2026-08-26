import { searchUsers, searchChannels } from '@xyne/shared/utils';

const MAX_PARTICIPANT_SEARCH_RESULTS = 100;

/**
 * Shared participant-search ranking for the call modals (Instant / Scheduled /
 * thread add-participant).
 *
 * The call modals historically filtered their option lists with a naive
 * `label.includes(query)` substring test, which diverges from the `@`-mention
 * search in the message composer: substring matching misses display-name vs
 * old-name mismatches (e.g. "@V" -> "Venkatesh"), does not rank prefix / word
 * boundary hits first, and does not demote deactivated users.
 *
 * `rankParticipantOptions` routes each option bucket through the SAME matcher
 * that powers mention search (`searchUsers` / `searchChannels` from
 * `@xyne/shared/utils`), so participant search behaves identically everywhere.
 *
 * Options carry a prefixed `value` (`user:`, `channel:`, `user_group:`). User and
 * channel options also spread their raw entity fields (name / email / displayName
 * / status for users, name for channels) onto the option object, which is what the
 * matcher keys off. User groups are already query-filtered upstream by
 * `useUserGroupSearch`, so they are passed through unchanged rather than
 * re-filtered (which would drop valid semantic matches).
 */
export interface RankableOption {
  [key: string]: unknown;
  value: string;
  label: string;
  subtitle?: string | null;
  name?: unknown;
  email?: unknown;
  displayName?: unknown;
  status?: unknown;
}

type SearchableUserOption<T extends RankableOption> = T & {
  id: string;
  name: string;
  email: string;
  displayName?: string | null;
  status?: string | null;
};

const toSearchableUserOption = <T extends RankableOption>(option: T): SearchableUserOption<T> => ({
  ...option,
  // `value` (e.g. "user:<id>") is unique per option — used as the stable key for searchUsers'
  // token-pass dedup.
  id: option.value,
  name: typeof option.name === 'string' && option.name ? option.name : option.label,
  email: typeof option.email === 'string' ? option.email : '',
  displayName: typeof option.displayName === 'string' ? option.displayName : null,
  status: typeof option.status === 'string' ? option.status : null,
});

const toSearchableChannelOption = <T extends RankableOption>(option: T): T & { name: string } => ({
  ...option,
  name: typeof option.name === 'string' && option.name ? option.name : option.label,
});

export function rankParticipantOptions<T extends RankableOption>(options: T[], query: string): T[] {
  // Empty query: preserve the caller's existing ordering (already alphabetised).
  if (!query.trim()) return options;

  const users: T[] = [];
  const channels: T[] = [];
  const groups: T[] = [];

  for (const opt of options) {
    if (opt.value.startsWith('user:')) users.push(opt);
    else if (opt.value.startsWith('channel:')) channels.push(opt);
    else groups.push(opt); // `user_group:` and any future prefixes
  }

  // The shared Fuse matchers intentionally ignore one-character queries. Use
  // a lightweight substring fallback until there is enough input to rank, so
  // every participant picker can show matches from the first keystroke.
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 1) {
    const matches = (option: T): boolean => {
      const name = typeof option.name === 'string' ? option.name : '';
      const email = typeof option.email === 'string' ? option.email : '';
      const displayName = typeof option.displayName === 'string' ? option.displayName : '';
      return [option.label, name, email, displayName].some(value =>
        value.toLowerCase().includes(normalizedQuery),
      );
    };

    return [
      ...users.filter(matches).slice(0, MAX_PARTICIPANT_SEARCH_RESULTS),
      ...channels.filter(matches).slice(0, MAX_PARTICIPANT_SEARCH_RESULTS),
      ...groups,
    ];
  }

  // Some channel-member payloads arrive as `{ id, name }` with no email, while
  // the shared matcher dereferences both fields. Normalize them at this boundary.
  const rankedUsers: T[] =
    users.length > 0
      ? searchUsers<SearchableUserOption<T>>(
          users.map(toSearchableUserOption),
          query,
          Math.min(users.length, MAX_PARTICIPANT_SEARCH_RESULTS),
        )
      : [];

  const rankedChannels: T[] =
    channels.length > 0
      ? searchChannels<T & { name: string }>(
          channels.map(toSearchableChannelOption),
          query,
          Math.min(channels.length, MAX_PARTICIPANT_SEARCH_RESULTS),
        )
      : [];

  return [...rankedUsers, ...rankedChannels, ...groups];
}
