import {
  useMentionSearch as sharedUseMentionSearch,
  type UseMentionSearchResult,
  type UseMentionSearchOptions,
} from '@xyne/shared/hooks';
import { useAuth } from './useAuth';

export const useMentionSearch = (
  channelId?: string,
  threadParticipantIds?: ReadonlySet<string>,
  _conversationId?: string,
  options: UseMentionSearchOptions = {},
): UseMentionSearchResult => {
  const { user } = useAuth();
  return sharedUseMentionSearch(channelId, user?.id, threadParticipantIds, options);
};

export type { UseMentionSearchResult, UseMentionSearchOptions };
