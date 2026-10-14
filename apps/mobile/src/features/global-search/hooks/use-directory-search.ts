import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ChannelScopeType, ChannelType, ChannelVisibility } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { useAllChannels } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import {
  getChannelDisplayName,
  getDmAvatarUserIds,
  getOtherParticipantIds,
  getUserDisplayName,
  isDMChannel,
  isGroupDMChannel,
} from '@/src/utils/channel-utils';
import { getActiveUserStatusEmoji, isUserDeactivated } from '@/src/utils/statusUtils';
import { createNameSearch, createPeopleSearch, type Search } from '../utils/directory-search';
import type { FilterInMode } from '../utils/filter-trigger';
import type {
  SearchChannelItem,
  SearchGroupDmItem,
  SearchInTargetItem,
  SearchPersonItem,
} from '../types';

/**
 * People, channels, group DMs and `in:` targets, searched on-device from synced
 * state. The backend has no suggestion endpoint, and these lists work offline.
 */

const PEOPLE_LIMIT = 25;
const CHANNELS_LIMIT = 40;
const GROUP_DMS_LIMIT = 25;
const TARGETS_LIMIT = 40;

type DirectoryUser = ReturnType<typeof useUsers>[number];

type ChannelStatus = {
  channelId: string;
  isDeleted?: boolean;
  isClosed?: boolean;
  isStarred?: boolean;
  unreadCount?: number;
};

function selectVisibleChannels(state: { context: { visibleChannels: unknown[] } }): unknown[] {
  return state.context.visibleChannels;
}

function selectChannelStatuses(state: {
  context: { userChannelStatuses: ChannelStatus[] };
}): ChannelStatus[] {
  return state.context.userChannelStatuses;
}

function statusMap(statuses: readonly ChannelStatus[]): Map<string, ChannelStatus> {
  return new Map(statuses.map(status => [status.channelId, status]));
}

/** What a list shows before anything is typed. */
function starredFirst<T extends { isStarred?: boolean }>(items: readonly T[], limit: number): T[] {
  return [...items]
    .sort((a, b) => Number(Boolean(b.isStarred)) - Number(Boolean(a.isStarred)))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type SearchablePerson = { user: DirectoryUser; name: string; email: string };

/**
 * One index per directory, shared by every list that searches people. The directory
 * array keeps its identity until a user actually changes, so the results tab, the
 * `from:` suggestions and the From sheet all reuse it.
 */
const peopleSearches = new WeakMap<readonly DirectoryUser[], Search<SearchablePerson>>();

function peopleSearchFor(users: readonly DirectoryUser[]): Search<SearchablePerson> {
  const cached = peopleSearches.get(users);
  if (cached) return cached;

  const people: SearchablePerson[] = [];
  for (const user of users) {
    if (isUserDeactivated(user)) continue;

    const email = user.email?.trim() ?? '';
    const name = user.displayName?.trim() || user.name?.trim() || email;
    if (name) people.push({ user, name, email });
  }

  const search = createPeopleSearch(people);
  peopleSearches.set(users, search);
  return search;
}

/** Includes yourself, so `from:` can filter to your own messages. */
export function usePeopleSearch(query: string): readonly SearchPersonItem[] {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const users = useUsers();

  return useMemo(
    () =>
      peopleSearchFor(users)(query, PEOPLE_LIMIT).map(({ user: match, name, email }) => {
        const statusEmoji = getActiveUserStatusEmoji(match);

        return {
          id: match.id,
          title: match.id === currentUserId ? `${name} (You)` : name,
          ...(email ? { subtitle: email } : {}),
          ...(statusEmoji ? { statusEmoji } : {}),
        };
      }),
    [currentUserId, query, users],
  );
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

type SearchableChannel = {
  id: string;
  name: string;
  visibility?: string;
  unreadCount?: number;
  isStarred?: boolean;
};

export function useChannelsSearch(query: string): readonly SearchChannelItem[] {
  const allChannels = useAllChannels();
  const visibleChannels = useSelector(stateMachineActor, selectVisibleChannels);
  const statuses = useSelector(stateMachineActor, selectChannelStatuses);

  const channels = useMemo(() => {
    const byStatus = statusMap(statuses);
    const byId = new Map<string, SearchableChannel>();

    // Public, joinable channels from the workspace catalog.
    for (const channel of allChannels as SearchableChannel[]) {
      const record = channel as unknown as {
        type?: unknown;
        scopeType?: unknown;
        visibility?: unknown;
        isArchived?: boolean;
      };
      if (record.type !== ChannelType.DEFAULT) continue;
      if (record.scopeType !== ChannelScopeType.DEFAULT) continue;
      if (record.visibility !== ChannelVisibility.PUBLIC) continue;
      if (record.isArchived) continue;

      byId.set(channel.id, {
        id: channel.id,
        name: channel.name,
        visibility: String(record.visibility),
      });
    }

    // Joined / visible channels, public and private, with unread + star metadata.
    for (const channel of visibleChannels as SearchableChannel[]) {
      const record = channel as unknown as { scopeType?: unknown; visibility?: unknown };
      if (record.scopeType !== ChannelScopeType.DEFAULT) continue;

      const status = byStatus.get(channel.id);
      if (status?.isDeleted || status?.isClosed) continue;

      byId.set(channel.id, {
        id: channel.id,
        name: channel.name,
        ...(record.visibility === undefined ? {} : { visibility: String(record.visibility) }),
        unreadCount: status?.unreadCount ?? 0,
        isStarred: status?.isStarred ?? false,
      });
    }

    return [...byId.values()];
  }, [allChannels, statuses, visibleChannels]);

  const search = useMemo(() => createNameSearch(channels), [channels]);

  return useMemo(() => {
    // Users often type Slack-style `#engineering`; match against bare names.
    const normalized = query.trim().replace(/^#/, '');
    const matches = normalized
      ? search(normalized, CHANNELS_LIMIT)
      : starredFirst(channels, CHANNELS_LIMIT);

    return matches.map((channel): SearchChannelItem => ({
      id: channel.id,
      title: channel.name.startsWith('#') ? channel.name : `#${channel.name}`,
      ...(channel.visibility ? { visibility: channel.visibility } : {}),
      ...(channel.unreadCount && channel.unreadCount > 0
        ? { unreadCount: channel.unreadCount }
        : {}),
      ...(channel.isStarred ? { isStarred: true } : {}),
    }));
  }, [channels, query, search]);
}

// ---------------------------------------------------------------------------
// Group DMs
// ---------------------------------------------------------------------------

type GroupDm = SearchGroupDmItem & { participantNames: string[] };

/** 0 for a prefix, 1 for a word boundary, 2 for anywhere; null when nothing matches. */
function tokenRank(names: readonly string[], token: string): number | null {
  let best: number | null = null;
  for (const name of names) {
    const rank = name.startsWith(token)
      ? 0
      : name.includes(` ${token}`)
        ? 1
        : name.includes(token)
          ? 2
          : null;
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

export function useGroupDmsSearch(query: string): readonly SearchGroupDmItem[] {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const users = useUsers();
  const visibleChannels = useSelector(stateMachineActor, selectVisibleChannels);
  const statuses = useSelector(stateMachineActor, selectChannelStatuses);

  const groupDms = useMemo(() => {
    if (!currentUserId) return [];

    const usersById = new Map(users.map(u => [u.id, u]));
    const byStatus = statusMap(statuses);
    const found: GroupDm[] = [];

    for (const channel of visibleChannels as { id: string; scopeType: unknown }[]) {
      if (!isGroupDMChannel(channel.scopeType as never)) continue;

      const status = byStatus.get(channel.id);
      if (status?.isDeleted || status?.isClosed) continue;

      const participantNames = getOtherParticipantIds(channel as never, currentUserId)
        .map(id => usersById.get(id))
        .filter((candidate): candidate is DirectoryUser => Boolean(candidate))
        .map(candidate => getUserDisplayName(candidate).toLowerCase());

      if (participantNames.length === 0) continue;

      found.push({
        id: channel.id,
        title: getChannelDisplayName(channel as never, currentUserId, usersById as never),
        avatarUserIds: getDmAvatarUserIds(channel as never, currentUserId),
        ...(status?.isStarred ? { isStarred: true } : {}),
        participantNames,
      });
    }

    return found;
  }, [currentUserId, statuses, users, visibleChannels]);

  return useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return starredFirst(groupDms, GROUP_DMS_LIMIT).map(toGroupDmItem);

    const tokens = normalized.split(/[,\s]+/).filter(Boolean);
    if (tokens.length === 0) return [];

    // Dashboard parity: every token must match some participant. A plain scan rather
    // than Fuse — there are tens of group DMs, and an index would cost more.
    const ranked: { groupDm: GroupDm; score: number }[] = [];

    for (const groupDm of groupDms) {
      let total = 0;
      for (const token of tokens) {
        const rank = tokenRank(groupDm.participantNames, token);
        if (rank === null) {
          total = -1;
          break;
        }
        total += rank;
      }
      if (total >= 0) ranked.push({ groupDm, score: total / tokens.length });
    }

    return ranked
      .sort((a, b) => a.score - b.score || a.groupDm.title.localeCompare(b.groupDm.title))
      .slice(0, GROUP_DMS_LIMIT)
      .map(entry => toGroupDmItem(entry.groupDm));
  }, [groupDms, query]);
}

function toGroupDmItem({ participantNames: _names, ...item }: GroupDm): SearchGroupDmItem {
  return item;
}

// ---------------------------------------------------------------------------
// `in:` targets — channels and DMs together
// ---------------------------------------------------------------------------

type Target = {
  id: string;
  name: string;
  kind: 'channel' | 'dm';
  visibility?: string;
  isStarred?: boolean;
  avatarUserIds?: string[];
};

export function useInTargetsSearch(
  query: string,
  mode: FilterInMode = 'all',
): readonly SearchInTargetItem[] {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const users = useUsers();
  const visibleChannels = useSelector(stateMachineActor, selectVisibleChannels);
  const statuses = useSelector(stateMachineActor, selectChannelStatuses);

  const targets = useMemo(() => {
    const usersById = new Map(users.map(u => [u.id, u]));
    const byStatus = statusMap(statuses);
    const found: Target[] = [];

    for (const channel of visibleChannels as {
      id: string;
      name: string;
      scopeType: unknown;
      visibility?: unknown;
    }[]) {
      const status = byStatus.get(channel.id);
      if (status?.isDeleted || status?.isClosed) continue;

      if (isDMChannel(channel.scopeType as never)) {
        if (!currentUserId) continue;
        found.push({
          id: channel.id,
          name: getChannelDisplayName(channel as never, currentUserId, usersById as never),
          kind: 'dm',
          isStarred: status?.isStarred ?? false,
          avatarUserIds: getDmAvatarUserIds(channel as never, currentUserId),
        });
        continue;
      }

      if (channel.scopeType !== ChannelScopeType.DEFAULT) continue;

      found.push({
        id: channel.id,
        name: channel.name.replace(/^#/, ''),
        kind: 'channel',
        ...(channel.visibility === undefined ? {} : { visibility: String(channel.visibility) }),
        isStarred: status?.isStarred ?? false,
      });
    }

    return found;
  }, [currentUserId, statuses, users, visibleChannels]);

  // `in:#` and `in:@` narrow here rather than above, so switching between them does
  // not rebuild the list of conversations.
  const inMode = useMemo(
    () =>
      mode === 'all'
        ? targets
        : targets.filter(target =>
            mode === 'dms' ? target.kind === 'dm' : target.kind === 'channel',
          ),
    [mode, targets],
  );

  const search = useMemo(() => createNameSearch(inMode), [inMode]);

  return useMemo(() => {
    const matches = query.trim()
      ? search(query, TARGETS_LIMIT)
      : starredFirst(inMode, TARGETS_LIMIT);

    return matches.map((target): SearchInTargetItem => ({
      id: target.id,
      title: target.kind === 'channel' ? `#${target.name}` : target.name,
      kind: target.kind,
      ...(target.visibility ? { visibility: target.visibility } : {}),
      ...(target.avatarUserIds && target.avatarUserIds.length > 0
        ? { avatarUserIds: target.avatarUserIds }
        : {}),
    }));
  }, [inMode, query, search]);
}
