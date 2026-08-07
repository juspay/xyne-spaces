import { searchUsers, searchChannels } from '@xyne/shared/utils';

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
  name: string;
  email: string;
  displayName?: string | null;
  status?: string | null;
};

const toSearchableUserOption = <T extends RankableOption>(option: T): SearchableUserOption<T> => ({
  ...option,
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

  // Some channel-member payloads arrive as `{ id, name }` with no email, while
  // the shared matcher dereferences both fields. Normalize them at this boundary.
  const rankedUsers: T[] =
    users.length > 0
      ? searchUsers<SearchableUserOption<T>>(users.map(toSearchableUserOption), query, users.length)
      : [];

  const rankedChannels: T[] =
    channels.length > 0
      ? searchChannels<T & { name: string }>(
          channels.map(toSearchableChannelOption),
          query,
          channels.length,
        )
      : [];

  return [...rankedUsers, ...rankedChannels, ...groups];
}
