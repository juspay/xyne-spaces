/**
 * Typed-prefix suggestions for the full-screen search box.
 *
 * The palette gets this from a Lexical editor with mention plugins; the results screen has
 * a plain input, so `from:` there could only be set by clicking the From button. This
 * watches what's being typed and offers the same candidates.
 *
 * Which prefixes exist and what each one picks comes from the registry (`entry.syntax` +
 * `entry.control`), so a new filter is offered here without touching this file.
 */
import { useMemo } from 'react';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { useUserSearch, useUsers } from '../../../../hooks/useUsers';
import { useAllVisibleChannels } from '../../../../hooks/useChannels';
import { useAuthContextValues } from '../../../../hooks/useAuth';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { isDMChannel, resolveChannelLabel } from '../../ChatDirectory/ChatDirectory.utils';
import {
  DATE_RANGE_OPTIONS,
  entriesFor,
  type FilterEntry,
} from '../../../../search/filterRegistry';
import { resolveDateKeyword } from '../../../../search/filterModel';
import type { SearchResultsFilters } from '../../../../hooks/useSearchResultsScreen';

export interface QuerySuggestion {
  id: string;
  label: string;
  /** Drawn by the renderer; the hook stays free of JSX. */
  icon:
    | { kind: 'user'; userId: string }
    | { kind: 'channel'; channelId: string }
    | { kind: 'value' };
  /** The filter change this suggestion makes, given the filters it's applied to. */
  apply: (filters: SearchResultsFilters) => Partial<SearchResultsFilters>;
}

export interface ActiveTypeahead {
  /** The prefix being typed, e.g. `from:`. */
  syntax: string;
  /** What's been typed after it. */
  query: string;
  /** Where the prefix starts, so the caller can cut it out of the input on pick. */
  index: number;
  suggestions: QuerySuggestion[];
}

/** Appends to a list-valued filter, ignoring a value that's already applied. */
const addTo = (entry: FilterEntry, filters: SearchResultsFilters, id: string) => {
  const current = entry.getValue?.(filters);
  const list = Array.isArray(current) ? current : [];
  return list.includes(id) ? {} : (entry.setValue?.([...list, id]) ?? {});
};

const MAX = 8;

/**
 * The date filter is the one entry with three prefixes, so it can't be found by the single
 * `entry.syntax` the others carry. Which one was typed decides where the picked date lands:
 * `on:` is a one-day window, the other two set a single bound.
 */
const DATE_SYNTAXES = ['on:', 'after:', 'before:'] as const;

export function useQuerySuggestions(
  value: string,
  filters: SearchResultsFilters,
): ActiveTypeahead | null {
  // Only a prefix at the very end is "in progress" — anything earlier the user has moved
  // on from. The query may be empty (`from:` alone lists everyone) and may contain spaces,
  // so a demoted multi-word chip (`from:Nasim Sheikh`) re-arms — same rule the palette's
  // trigger uses (see MentionPlugin's `atMatch`).
  const match = /(^|\s)([a-z]+:)(.*)$/i.exec(value);
  const typedSyntax = match?.[2]?.toLowerCase() ?? '';
  const typedQuery = match?.[3] ?? '';

  const entry = useMemo(() => {
    const available = entriesFor(filters.docType);
    if ((DATE_SYNTAXES as readonly string[]).includes(typedSyntax)) {
      return available.find(e => e.id === 'date') ?? null;
    }
    return (
      available.find(e => e.syntax && e.control && e.syntax.toLowerCase() === typedSyntax) ?? null
    );
  }, [filters.docType, typedSyntax]);

  const kind = entry?.control?.kind;
  // Hooks can't be conditional, so every source is subscribed and the unused ones are
  // simply not read. They're all cached/shared, so this costs nothing extra.
  const users =
    useUserSearch(kind === 'people' || kind === 'mentions' ? typedQuery : '', MAX) ?? [];
  const channels = useAllVisibleChannels();
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  // A DM's `name` column is its participant ids, comma-joined — shown raw it's a cuid.
  const allUsers = useUsers();
  const { userID: currentUserId } = useAuthContextValues();

  return useMemo(() => {
    if (!match || !entry || !entry.control) return null;
    const control = entry.control;
    const searchTerm = typedQuery.toLowerCase().trim();
    const index = (match.index ?? 0) + (match[1]?.length ?? 0);
    const base = { syntax: entry.syntax as string, query: typedQuery, index };

    const peopleOptions = (): QuerySuggestion[] =>
      users.slice(0, MAX).map(user => ({
        id: user.id,
        label: getUserDisplayName(user),
        icon: { kind: 'user' as const, userId: user.id },
        apply: (currentFilters: SearchResultsFilters) => addTo(entry, currentFilters, user.id),
      }));

    const nameOf = (channel: (typeof channels)[number]): string =>
      resolveChannelLabel(channel, currentUserId ?? '', allUsers);

    const channelOptions = (excludeDMs: boolean): QuerySuggestion[] =>
      channels
        .filter(channel => (excludeDMs ? !isDMChannel(channel.scopeType) : true))
        // Match the resolved label, so typing a person's name finds their DM.
        .filter(channel => (searchTerm ? nameOf(channel).toLowerCase().includes(searchTerm) : true))
        .slice(0, MAX)
        .map(channel => ({
          id: channel.id,
          label: nameOf(channel),
          icon: { kind: 'channel' as const, channelId: channel.id },
          apply: (currentFilters: SearchResultsFilters) => addTo(entry, currentFilters, channel.id),
        }));

    switch (control.kind) {
      case 'people':
        return { ...base, suggestions: peopleOptions() };
      case 'channels':
        return { ...base, suggestions: channelOptions(control.excludeDMs ?? false) };
      // `mentions:` is the one prefix over two kinds — people and channels share it, and
      // the picked candidate's own type decides which field it lands in.
      case 'mentions':
        return {
          ...base,
          suggestions: [
            ...users.slice(0, MAX / 2).map(user => ({
              id: user.id,
              label: `@${getUserDisplayName(user)}`,
              icon: { kind: 'user' as const, userId: user.id },
              apply: (currentFilters: SearchResultsFilters) =>
                currentFilters.mentionUserIds.includes(user.id)
                  ? {}
                  : { mentionUserIds: [...currentFilters.mentionUserIds, user.id] },
            })),
            ...channels
              .filter(channel => !isDMChannel(channel.scopeType))
              .filter(channel =>
                searchTerm ? nameOf(channel).toLowerCase().includes(searchTerm) : true,
              )
              .slice(0, MAX / 2)
              .map(channel => ({
                id: channel.id,
                label: nameOf(channel),
                icon: { kind: 'channel' as const, channelId: channel.id },
                apply: (currentFilters: SearchResultsFilters) =>
                  currentFilters.mentionChannelIds.includes(channel.id)
                    ? {}
                    : { mentionChannelIds: [...currentFilters.mentionChannelIds, channel.id] },
              })),
          ],
        };
      case 'boards': {
        const rows = (boards ?? []) as ReadonlyArray<{ id: string; name: string }>;
        return {
          ...base,
          suggestions: rows
            .filter(board => (searchTerm ? board.name?.toLowerCase().includes(searchTerm) : true))
            .slice(0, MAX)
            .map(board => ({
              id: board.id,
              label: board.name,
              icon: { kind: 'value' as const },
              apply: (currentFilters: SearchResultsFilters) =>
                addTo(entry, currentFilters, board.id),
            })),
        };
      }
      case 'enumMulti':
        return {
          ...base,
          suggestions: control.options
            .filter(option => (searchTerm ? option.label.toLowerCase().includes(searchTerm) : true))
            .map(option => ({
              id: option.value,
              label: option.label,
              icon: { kind: 'value' as const },
              apply: (currentFilters: SearchResultsFilters) =>
                addTo(entry, currentFilters, option.value),
            })),
        };
      // Single-valued (priority): picking replaces rather than appends.
      case 'enumSingle':
        return {
          ...base,
          suggestions: control.options
            .filter(
              option =>
                option.value &&
                (searchTerm ? option.label.toLowerCase().includes(searchTerm) : true),
            )
            .map(option => ({
              id: option.value,
              label: option.label,
              icon: { kind: 'value' as const },
              apply: () => entry.setValue?.(option.value) ?? {},
            })),
        };
      // Presets plus whatever's already been typed if it looks like a date, mirroring the
      // palette's list. A preset carries its keyword rather than the dates it resolves to,
      // so the window stays live; a typed date lands on the bound its prefix names.
      case 'date': {
        const dated = (value: string): Partial<SearchResultsFilters> =>
          typedSyntax === 'on:'
            ? { dateRange: '', after: value, before: value }
            : typedSyntax === 'after:'
              ? { dateRange: '', after: value }
              : { dateRange: '', before: value };

        const typedDate = /^\d{4}-\d{2}-\d{2}$/.test(searchTerm)
          ? [
              {
                id: searchTerm,
                label: searchTerm,
                icon: { kind: 'value' as const },
                apply: () => dated(searchTerm),
              },
            ]
          : [];

        return {
          ...base,
          suggestions: [
            ...typedDate,
            ...DATE_RANGE_OPTIONS.filter(
              option =>
                option.value &&
                resolveDateKeyword(option.value) &&
                (searchTerm ? option.label.toLowerCase().includes(searchTerm) : true),
            ).map(option => ({
              id: option.value,
              label: option.label,
              icon: { kind: 'value' as const },
              // A preset is a window, not a bound — it replaces both, whichever prefix
              // reached for it.
              apply: () => ({ dateRange: option.value, after: '', before: '' }),
            })),
          ],
        };
      }
      // `tags:` takes free text — there's no vocabulary to offer, and typing it already
      // works, so no dropdown.
      default:
        return null;
    }
  }, [match, entry, typedQuery, typedSyntax, users, channels, boards, allUsers, currentUserId]);
}
