import { ReactElement, useMemo } from 'react';

import MessagesIcon from '../../icons/MessagesIcon';
import { PinIcon, NotebookText, FolderOpen, SquareKanban, Link } from 'lucide-react';
import { useCanReadTicket } from '../../../hooks/usePermissions';
import { ChannelScopeType } from '@xyne/shared';
import { isDMChannel } from '../ChatDirectory/ChatDirectory.utils';

export interface ConversationTabListType {
  label: string;
  value: string;
  icon: ReactElement;
}

// Static tabs that are always available
const STATIC_TABS: ConversationTabListType[] = [
  {
    label: 'Messages ',
    value: 'messages',
    icon: <MessagesIcon />,
  },
  {
    label: 'Files',
    value: 'files',
    icon: <FolderOpen size={14} />,
  },
  {
    label: 'Pins',
    value: 'pins',
    icon: <PinIcon size={14} />,
  },
  {
    label: 'Canvas',
    value: 'canvas',
    icon: <NotebookText size={14} />,
  },
  {
    label: 'Links',
    value: 'links',
    icon: <Link size={14} />,
  },
];

// Conditional Tickets tab
const TICKETS_TAB: ConversationTabListType = {
  label: 'Tickets',
  value: 'tickets',
  icon: <SquareKanban size={14} />,
};

// Stable references — a fresh `[...STATIC_TABS, TICKETS_TAB]` and fresh
// closures per render made ConversationPanelV2's memoized tab handler and
// context value unstable, re-rendering every visible message bubble.
const TABS_WITH_TICKETS: ConversationTabListType[] = [...STATIC_TABS, TICKETS_TAB];
const getDefaultTab = (): string => 'messages';

// Hook to get conversation tabs based on permissions and channel scope type
export const useConversationTabs = (channelScopeType?: ChannelScopeType) => {
  const canReadTicket = useCanReadTicket();

  // Tickets tab should not be shown for DM and GROUP_DM channels
  const isDMOrGroupDM = channelScopeType ? isDMChannel(channelScopeType) : false;

  // Include Tickets tab only if user has READ access AND it's not a DM or GROUP_DM
  const availableTabs = canReadTicket && !isDMOrGroupDM ? TABS_WITH_TICKETS : STATIC_TABS;

  return useMemo(
    () => ({
      availableTabs,
      getDefaultTab,
      isValidTab: (tab: string) => availableTabs.some(t => t.value === tab),
    }),
    [availableTabs],
  );
};

// Export the static list for backward compatibility (deprecated)
// Use useConversationTabs() instead for permission-based filtering
export const CONVERSATION_TABS_LIST: ConversationTabListType[] = STATIC_TABS;
