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
  onSelectMessageContext?: (
    channelId: string,
    conversationId: string,
    conversationCreatedAt?: number,
    matchedMessageId?: string | null,
  ) => void;
  // Fires when a result opens through a path with no pane handler (the jump-to-home
  // button), so the parent can still record it as a recent search.
  onResultOpen?: () => void;
}>({});
