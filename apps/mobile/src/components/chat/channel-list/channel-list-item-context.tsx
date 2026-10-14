import type { ChannelListItemData } from '@/src/types/channel-list';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const ChannelListItemContext = createContext<ChannelListItemData | null>(null);

export function ChannelListItemProvider({
  value,
  children,
}: {
  value: ChannelListItemData;
  children: ReactNode;
}) {
  return (
    <ChannelListItemContext.Provider value={value}>{children}</ChannelListItemContext.Provider>
  );
}

export function useChannelListItemContext(): ChannelListItemData {
  const ctx = useContext(ChannelListItemContext);
  if (!ctx) {
    throw new Error('ChannelListItem subcomponents must be rendered inside <ChannelListItem>.');
  }
  return ctx;
}
