import type { DmListItemData } from '@/src/types/dm-list-item';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const DmListItemContext = createContext<DmListItemData | null>(null);

export function ChatListItemProvider({
  value,
  children,
}: {
  value: DmListItemData;
  children: ReactNode;
}) {
  return <DmListItemContext.Provider value={value}>{children}</DmListItemContext.Provider>;
}

export function useDmListItemContext(): DmListItemData {
  const ctx = useContext(DmListItemContext);
  if (!ctx) {
    throw new Error('ChatListItem subcomponents must be rendered inside <ChatListItem>.');
  }
  return ctx;
}
