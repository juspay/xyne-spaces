import { createContext } from 'react';

export type SearchResultsThread = {
  channelId: string;
  conversationId: string;
  matchedMessageId?: string | null;
};

export const SearchResultsContext = createContext<{
  onSelectThread?: (thread: SearchResultsThread) => void;
  onSelectUser?: (userId: string) => void;
  onSelectChannelContext?: (
    channelId: string,
    conversationId: string,
    conversationCreatedAt?: number,
    matchedMessageId?: string | null,
  ) => void;
}>({});
