import { createContext } from 'react';

export type SearchResultsThread = { channelId: string; conversationId: string };

export const SearchResultsContext = createContext<{
  onSelectThread?: (thread: SearchResultsThread) => void;
  onSelectUser?: (userId: string) => void;
}>({});
