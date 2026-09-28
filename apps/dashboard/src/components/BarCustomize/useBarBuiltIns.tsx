import { useMemo, type ReactNode } from 'react';
import type { ChannelScopeType } from '@xyne/shared';
import { useVisibleNavigationItems } from '../../hooks/useVisibleNavigationItems';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { useAuth } from '../../hooks/useAuth';
import { chatNavItems } from '../AppSidebar/navigationConfig';
import { useAvailableBuiltInTabs } from '../Chat/ConversationPannel/ConversationPannel.utils';

/** A bar's built-in entry as the add menu and the Preferences customizer draw it. */
export interface BarBuiltIn {
  id: string;
  label: string;
  icon: ReactNode;
}

// One hook per bar so the in-bar "+" and Preferences offer exactly the same
// built-ins, gated the same way (permissions, radar flag, ticket access).

export const useToolbarBuiltIns = (): BarBuiltIn[] => {
  const items = useVisibleNavigationItems();
  return useMemo(
    () =>
      items.map(item => {
        const Icon = item.icon;
        return { id: item.path, label: item.label, icon: <Icon size={16} /> };
      }),
    [items],
  );
};

export const useInboxBuiltIns = (): BarBuiltIn[] => {
  const { user } = useAuth();
  const radarEnabled = useRadarEnabled(user?.email);
  return useMemo(
    () =>
      chatNavItems(radarEnabled).map(item => {
        const Icon = item.icon;
        return { id: item.key, label: item.label, icon: <Icon size={16} /> };
      }),
    [radarEnabled],
  );
};

/** Pass the channel's scope so Tickets is offered only where it can show. */
export const useChannelTabBuiltIns = (channelScopeType?: ChannelScopeType): BarBuiltIn[] => {
  const tabs = useAvailableBuiltInTabs(channelScopeType);
  return useMemo(
    () => tabs.map(tab => ({ id: tab.value, label: tab.label.trim(), icon: tab.icon })),
    [tabs],
  );
};
