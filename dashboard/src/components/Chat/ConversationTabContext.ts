import { createContext } from 'react';

export const ConversationTabContext = createContext<{
  setActiveTab: (tab: string, e?: React.MouseEvent) => void;
  setSkipMarkAsRead: (skip: boolean) => void;
  skipMarkAsReadRef: React.MutableRefObject<boolean> | null;
  setSkipScrollReset: (skip: boolean) => void;
  skipScrollResetRef: React.MutableRefObject<boolean> | null;
}>({
  setActiveTab: () => {},
  setSkipMarkAsRead: () => {
    console.warn('setSkipMarkAsRead called outside ConversationTabContext provider');
  },
  skipMarkAsReadRef: null,
  setSkipScrollReset: () => {
    console.warn('setSkipScrollReset called outside ConversationTabContext provider');
  },
  skipScrollResetRef: null,
});
