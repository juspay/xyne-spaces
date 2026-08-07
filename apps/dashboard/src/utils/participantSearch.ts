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
  value: string;
  label: string;
  subtitle?: string | null;
  name?: string;
  email?: string;
  displayName?: string | null;
  status?: string | null;
}

export function rankParticipantOptions<T extends RankableOption>(
  options: T[],
  query: string,
): T[] {
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

  // Coerce name/email to strings before handing options to the matcher — some
  // channel-member payloads arrive as `{ id, name }` with no email, and the
  // rescoring step dereferences `.email`.
  const rankedUsers =
    users.length > 0
      ? searchUsers(
          users.map(u => ({
            ...u,
            name: typeof u.name === 'string' && u.name ? u.name : u.label,
            email: typeof u.email === 'string' ? u.email : '',
          })) as unknown as Parameters<typeof searchUsers>[0],
          query,
          users.length,
        )
      : [];

  const rankedChannels =
    channels.length > 0
      ? searchChannels(
          channels.map(c => ({
            ...c,
            name: typeof c.name === 'string' && c.name ? c.name : c.label,
          })) as unknown as Parameters<typeof searchChannels>[0],
          query,
          channels.length,
        )
      : [];

  return [...rankedUsers, ...rankedChannels, ...groups] as unknown as T[];
}
