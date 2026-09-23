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
import { getChannelTabsStore, useAppSnapshots, appIdOf, appItemId } from '../../../hooks/barItems';

export interface ConversationTabListType {
  label: string;
  value: string;
  icon: ReactElement;
}

/** The tab every channel opens on and the only one a user cannot remove. */
export const DEFAULT_CONVERSATION_TAB = 'messages';

// Built-in tabs. In a customizable channel the header renders the user's
// ordered selection of these plus any artifact apps they added; this is the
// full set the picker offers, and the fixed list everywhere else.
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

/**
 * Whether this channel's tabs can be customized. Only real channels qualify,
 * public and private alike — a DM, a group DM or a ticket/document channel
 * shows the built-in tabs and offers no editing affordances.
 */
export const isChannelTabsCustomizable = (channelScopeType?: ChannelScopeType): boolean =>
  channelScopeType === ChannelScopeType.DEFAULT;

// Hook to get conversation tabs for this channel: the user's own ordered
// selection where that is allowed, the built-in list everywhere else.
//
// Stable references matter here: a fresh `availableTabs` array and fresh
// closures per render made ConversationPanelV2's memoized tab handler and
// context value unstable, re-rendering every visible message bubble. Everything
// is memoized on the store's own (stable-until-changed) snapshots.
export const useConversationTabs = (channelId: string, channelScopeType?: ChannelScopeType) => {
  // Read unconditionally — a hook cannot be skipped for a DM. The store for a
  // non-customizable channel is only ever read, never written, so subscribing
  // to it costs a listener and nothing else.
  const ids = getChannelTabsStore(channelId || 'unknown').useItems();
  const snapshots = useAppSnapshots();
  const ticketsAllowed = useTicketsTabAllowed(channelScopeType);
  const builtInTabs = useAvailableBuiltInTabs(channelScopeType);
  const customizable = isChannelTabsCustomizable(channelScopeType);

  const availableTabs = useMemo((): ConversationTabListType[] => {
    if (!customizable) return builtInTabs;
    const tabs: ConversationTabListType[] = [];
    for (const id of ids) {
      const appId = appIdOf(id);
      if (appId) {
        const snapshot = snapshots.get(appId);
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
    // `messages` is locked in every channel store, so it is always among `ids`.
    return tabs;
  }, [customizable, builtInTabs, ids, snapshots, ticketsAllowed]);

  return useMemo(
    () => ({
      availableTabs,
      getDefaultTab,
      isValidTab: (tab: string) => availableTabs.some(t => t.value === tab),
    }),
    [availableTabs],
  );
};
