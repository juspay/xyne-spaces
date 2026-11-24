import type { ReactElement, ReactNode } from 'react';

import {
  ChannelFindControlsContext,
  ChannelFindMatchesContext,
  useChannelFind,
} from '../hooks/use-channel-find';

type ChannelFindProviderProps = {
  channelId: string;
  /** The room's name, for the search scope. */
  channelLabel: string;
  children: ReactNode;
};

/**
 * Owns find in this channel. Opening, each committed query and every page
 * re-render only this provider; `children` keeps its identity, so only the
 * header and the results, which read it, update.
 */
export function ChannelFindProvider({
  channelId,
  channelLabel,
  children,
}: ChannelFindProviderProps): ReactElement {
  const { controls, matches } = useChannelFind(channelId, channelLabel);
  return (
    <ChannelFindControlsContext.Provider value={controls}>
      <ChannelFindMatchesContext.Provider value={matches}>
        {children}
      </ChannelFindMatchesContext.Provider>
    </ChannelFindControlsContext.Provider>
  );
}
