import { useCallback, useEffect, useMemo, useState } from 'react';
import { TabType, ChipType } from '../ChannelCommandMenu.types';
import type { ChipData } from '../ChannelCommandMenu.types';
import { useUsers, useUsersById } from '../../../../hooks/useUsers';
import { useAllChannels } from '../../../../hooks/useChannels';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { resolveChannelLabel } from '../ChatDirectory.utils';
import {
  loadRecentSearches,
  saveCurrentSearchQuery,
  removeRecentSearch,
  identityKeyFor,
  type RecentSearchEntry,
  type StoredRecentSearch,
  type StoredChip,
} from './storage';

/** The live palette query, read at the save edge to decide what (if anything) to store. */
export interface RecentSearchQuery {
  text: string;
  filterChips: ChipData[];
  tab: TabType;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
}

/** Inputs the palette feeds the hook: the open/enabled gates, the identity keys, and the live query. */
export interface UseRecentSearchesParams {
  open: boolean;
  enabled: boolean;
  workspaceId: string;
  userId: string;
  query: RecentSearchQuery;
}

/** What the hook hands back to the palette: the recents list, its visibility, and remove/save actions. */
export interface UseRecentSearches {
  recents: RecentSearchEntry[];
  isVisible: boolean;
  remove: (identityKey: string) => void;
  /** Store the current query as a recent; the caller decides when. See {@link saveCurrentSearchQuery} for the trigger catalog. */
  save: () => void;
}

/**
 * The Cmd+K palette's recent-search feature: display state, localStorage, and live name
 * resolution. Exposes save() for the caller to invoke when it judges a query worth keeping —
 * the hook persists the current query and owns the list, but not the decision of when to save.
 *
 * Storage holds chip identity only; the display name is resolved live here (by id) so a rename
 * never shows a stale label, and the container is decoupled from name resolution entirely.
 *
 * @remarks
 * Use this hook only on a surface that DISPLAYS and replays recents (the palette empty state).
 * A surface that only needs to record a recent — with no list to render — skips the hook and
 * calls {@link saveCurrentSearchQuery} directly, as the full-screen results page (SearchResults)
 * does; the hook's list-ownership and name-resolution machinery would be dead weight there.
 */
export function useRecentSearches(params: UseRecentSearchesParams): UseRecentSearches {
  const { open, enabled, workspaceId, userId, query } = params;
  const [storedRecents, setStoredRecents] = useState<StoredRecentSearch[]>([]);

  // Shared, in-memory reads off the same XState store the container uses — no extra fetch.
  const allUsers = useUsers();
  const usersById = useUsersById();
  const allChannels = useAllChannels();
  const allUserGroups = useUserGroups();

  // Load fresh on open (the util prunes >30-day entries).
  useEffect(() => {
    if (!open) return;
    setStoredRecents(enabled ? loadRecentSearches(workspaceId, userId) : []);
  }, [open, enabled, workspaceId, userId]);

  // Rebuild each chip's display name from live data, falling back to the id when it can't be
  // resolved. BOARD keeps the label it was stored with; priority/date/entity read theirs off id.
  const resolveStoredChip = useCallback(
    (stored: StoredChip): ChipData => {
      if (stored.type === ChipType.USER) {
        const user = usersById.get(stored.id);
        return { ...stored, name: user ? getUserDisplayName(user) : stored.id };
      }
      if (stored.type === ChipType.CHANNEL) {
        const channel = allChannels.find(candidate => candidate.id === stored.id);
        return {
          ...stored,
          name: channel ? resolveChannelLabel(channel, userId, allUsers) : stored.id,
        };
      }
      // A user-group mention reads by its handle (`alias ?? name`), matching every other chip surface.
      if (stored.type === ChipType.USER_GROUP) {
        const group = allUserGroups.find(candidate => candidate.id === stored.id);
        return { ...stored, name: group ? (group.alias ?? group.name) : stored.id };
      }
      return { ...stored, name: stored.name ?? stored.id };
    },
    [usersById, allChannels, allUsers, allUserGroups, userId],
  );

  // Layer live display names over the stored identity, re-resolving only when the history or
  // the user/channel data changes — not on every keystroke.
  const recents = useMemo<RecentSearchEntry[]>(
    () =>
      storedRecents.map(entry => ({
        ...entry,
        filterChips: entry.filterChips.map(resolveStoredChip),
      })),
    [storedRecents, resolveStoredChip],
  );

  // Store the current query as a recent (no-op unless the feature is enabled).
  const save = (): void => {
    if (!enabled) return;
    saveCurrentSearchQuery(workspaceId, userId, query);
  };

  // Recents show only in the All-tab empty state (no text, no chips, history present).
  const isVisible =
    enabled &&
    query.tab === TabType.ALL &&
    !query.text.trim() &&
    query.filterChips.length === 0 &&
    storedRecents.length > 0;

  const remove = useCallback(
    (identityKey: string) => {
      removeRecentSearch(workspaceId, userId, identityKey);
      setStoredRecents(prev => prev.filter(entry => identityKeyFor(entry) !== identityKey));
    },
    [workspaceId, userId],
  );

  return { recents, isVisible, remove, save };
}
