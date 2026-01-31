import { createContext } from 'react';

export const ConversationTabContext = createContext<{
  setActiveTab: (tab: string, e?: React.MouseEvent) => void;
}>({
  setActiveTab: () => {},
});
