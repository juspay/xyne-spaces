import { ReactElement, useMemo } from 'react';

import {
  ChatDefault,
  FolderDefault,
  PinDefault,
  File02Text,
  LinkChainSlant,
  TicketToken,
} from '@xyne/icons';
import { useCanReadTicket } from '../../../hooks/usePermissions';
import { ChannelScopeType } from '@xyne/shared';
import { isDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { AppIcon } from '../../AppIcon/AppIcon';
import { channelTabsStore, useAppSnapshots, appIdOf, appItemId } from '../../../hooks/barItems';

export interface ConversationTabListType {
  label: string;
  value: string;
  icon: ReactElement;
}

/** The tab every channel opens on and the only one a user cannot remove. */
export const DEFAULT_CONVERSATION_TAB = 'messages';

// Built-in tabs. The channel header renders the user's ordered selection of
// these (channelTabsStore) plus any artifact apps they added; this is the full
// set the picker offers.
export const STATIC_TABS: ConversationTabListType[] = [
  {
    label: 'Messages ',
    value: DEFAULT_CONVERSATION_TAB,
    icon: <ChatDefault size={14} />,
  },
  {
    label: 'Files',
    value: 'files',
    icon: <FolderDefault size={14} />,
  },
  {
    label: 'Pins',
    value: 'pins',
    icon: <PinDefault size={14} />,
  },
  {
    label: 'Canvas',
    value: 'canvas',
    icon: <File02Text size={14} />,
  },
  {
    label: 'Links',
    value: 'links',
    icon: <LinkChainSlant size={14} />,
  },
];

// Conditional Tickets tab
export const TICKETS_TAB: ConversationTabListType = {
  label: 'Tickets',
  value: 'tickets',
  icon: <TicketToken size={14} />,
};

const BUILT_IN_TABS = new Map<string, ConversationTabListType>(
  [...STATIC_TABS, TICKETS_TAB].map(tab => [tab.value, tab]),
);

const getDefaultTab = (): string => DEFAULT_CONVERSATION_TAB;

// Tickets shows only where the user can read tickets and the channel is not a
// DM / group DM.
const useTicketsTabAllowed = (channelScopeType?: ChannelScopeType): boolean => {
  const canReadTicket = useCanReadTicket();
  const isDMOrGroupDM = channelScopeType ? isDMChannel(channelScopeType) : false;
  return canReadTicket && !isDMOrGroupDM;
};

/** Every built-in tab this channel may show, in canonical order — what the
 *  header's "+" and Preferences offer. */
export const useAvailableBuiltInTabs = (
  channelScopeType?: ChannelScopeType,
): ConversationTabListType[] => {
  const ticketsAllowed = useTicketsTabAllowed(channelScopeType);
  return useMemo(
    () => (ticketsAllowed ? [...STATIC_TABS, TICKETS_TAB] : STATIC_TABS),
    [ticketsAllowed],
  );
};

// Hook to get conversation tabs based on the user's selection, permissions and
// channel scope type.
//
// Stable references matter here: a fresh `availableTabs` array and fresh
// closures per render made ConversationPanelV2's memoized tab handler and
// context value unstable, re-rendering every visible message bubble. Everything
// is memoized on the store's own (stable-until-changed) snapshots.
export const useConversationTabs = (channelScopeType?: ChannelScopeType) => {
  const ids = channelTabsStore.useItems();
  const snapshots = useAppSnapshots();
  const ticketsAllowed = useTicketsTabAllowed(channelScopeType);

  const availableTabs = useMemo((): ConversationTabListType[] => {
    const tabs: ConversationTabListType[] = [];
    for (const id of ids) {
      const appId = appIdOf(id);
      if (appId) {
        const snapshot = snapshots[appId];
        if (!snapshot) continue;
        tabs.push({
          label: snapshot.title,
          value: appItemId(appId),
          icon: <AppIcon name={snapshot.icon} size={14} />,
        });
        continue;
      }
      if (id === TICKETS_TAB.value && !ticketsAllowed) continue;
      const tab = BUILT_IN_TABS.get(id);
      if (tab) tabs.push(tab);
    }
    // `messages` is locked in channelTabsStore, so it is always among `ids`.
    return tabs;
  }, [ids, snapshots, ticketsAllowed]);

  return useMemo(
    () => ({
      availableTabs,
      getDefaultTab,
      isValidTab: (tab: string) => availableTabs.some(t => t.value === tab),
    }),
    [availableTabs],
  );
};
