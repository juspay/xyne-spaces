import type { Channel } from '@xyne/shared';
import type { DisplaySearchResult } from '../../../types/search';
import type { ContextItem } from './ThreadContextPanel.types';

/** Build a URL for a search result (mirrors searchNavigation.ts logic without navigating) */
export const buildContextItemUrl = (result: DisplaySearchResult): string => {
  switch (result.type) {
    case 'channel':
      return `/chat/dir/${result.id}`;
    case 'user':
      return `/chat/dir/user/${result.id}`;
    case 'conversation': {
      const { channelId, conversationId, messageId, replyCount } = result.searchContext || {};
      if (!channelId) return '#';
      if (replyCount && replyCount > 0) {
        if (messageId) {
          return `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`;
        }
        return `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}`;
      }
      return `/chat/dir/${channelId}#origin=${conversationId}`;
    }
    case 'ticket': {
      const ticketId = result.searchContext?.ticketId || result.id;
      const { channelId, conversationId } = result.searchContext || {};
      if (!channelId || !conversationId) return '#';
      return `/chat/dir/${channelId}/${conversationId}/${ticketId}?selectedTab=details`;
    }
    case 'attachment': {
      if (result.searchContext?.originalUrl) return result.searchContext.originalUrl;
      if (result.searchContext?.channelId) return `/chat/dir/${result.searchContext.channelId}`;
      return '#';
    }
    default:
      return '#';
  }
};

/** Build a ContextItem from a backend search result */
export const buildContextItemFromResult = (result: DisplaySearchResult): ContextItem => ({
  id: `${result.type}-${result.id}`,
  title: result.title,
  type: result.type,
  url: buildContextItemUrl(result),
  searchResult: result,
});

/** Build a ContextItem from a local Channel */
export const buildContextItemFromChannel = (
  channel: Channel,
  displayName: string,
): ContextItem => ({
  id: `channel-${channel.id}`,
  title: displayName,
  type: 'channel',
  url: `/chat/dir/${channel.id}`,
  searchResult: {
    id: channel.id,
    type: 'channel',
    title: displayName,
    subtitle: '',
    relevanceScore: 0,
    metadata: {},
  } as DisplaySearchResult,
});
