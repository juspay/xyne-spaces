import { createContext } from 'react';

export type SearchResultsThread = {
  channelId: string;
  conversationId: string;
  matchedMessageId?: string | null;
  // Present when the thread is a board ticket — lets ThreadMessages show the Details/RCA tabs
  // immediately instead of waiting to derive the ticket from the conversation.
  ticketId?: string | null;
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
