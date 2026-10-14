import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { searchChannels } from '@xyne/shared/utils';
import type { VisibleChannel } from '@xyne/shared/hooks';
import { ChannelScopeType } from '@xyne/shared';

import { getChannelDisplayName } from '@/src/hooks/useChannels';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { groupChannelsByScope, isDMChannel, sortByActivity } from '@/src/utils/chatDirectory';

type SearchableChannel = {
  channel: VisibleChannel;
  name: string;
};

const EMPTY_VISIBLE_CHANNELS: VisibleChannel[] = [];
const EMPTY_USERS: Parameters<typeof getChannelDisplayName>[2] = [];

export type ChatDirectorySearchResults = {
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
  hasQuery: boolean;
};

/**
 * Shared search hook for Search tab and directory surfaces.
 * Reuses shared Fuse-based `searchChannels` scoring and dashboard grouping rules.
 */
export const useChatDirectorySearch = (
  query: string,
  currentUserId: string,
  enabled = true,
): ChatDirectorySearchResults => {
  const allChannels = useSelector(stateMachineActor, state =>
    enabled ? state.context.visibleChannels : EMPTY_VISIBLE_CHANNELS,
  );
  const users = useSelector(stateMachineActor, state =>
    enabled ? state.context.users : EMPTY_USERS,
  );
  const userChannelStatuses = useSelector(stateMachineActor, state =>
    enabled ? state.context.userChannelStatuses : [],
  );

  const { channels, directMessages } = useMemo(() => {
    if (!enabled) {
      return {
        channels: [],
        directMessages: [],
      };
    }

    const grouped = groupChannelsByScope(allChannels, userChannelStatuses);
    const starredChannels = grouped.starred.filter(
      channel => channel.scopeType === ChannelScopeType.DEFAULT,
    );
    const starredDms = grouped.starred.filter(channel => isDMChannel(channel.scopeType));

    return {
      channels: sortByActivity([...starredChannels, ...grouped.channels]),
      directMessages: sortByActivity([...starredDms, ...grouped.directMessages]),
    };
  }, [allChannels, enabled, userChannelStatuses]);

  const normalizedQuery = query.trim();

  const filteredChannels = useMemo(() => {
    if (!normalizedQuery) {
      return channels;
    }

    return searchChannels(channels, normalizedQuery, channels.length);
  }, [channels, normalizedQuery]);

  const searchableDms = useMemo((): SearchableChannel[] => {
    if (!enabled) {
      return [];
    }

    return directMessages.map(channel => ({
      channel,
      name: getChannelDisplayName(channel, currentUserId, users),
    }));
  }, [currentUserId, directMessages, enabled, users]);

  const filteredDirectMessages = useMemo(() => {
    if (!normalizedQuery) {
      return directMessages;
    }

    const matches = searchChannels(searchableDms, normalizedQuery, searchableDms.length);
    return matches.map(match => match.channel);
  }, [directMessages, normalizedQuery, searchableDms]);

  return {
    channels: filteredChannels,
    directMessages: filteredDirectMessages,
    hasQuery: normalizedQuery.length > 0,
  };
};
