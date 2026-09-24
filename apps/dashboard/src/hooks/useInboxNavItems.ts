import { createElement, useMemo, type ReactElement } from 'react';
import type { PikaIconProps } from '@xyne/icons';
import {
  CHAT_NAV_ITEMS,
  type ChatNavItem,
  type PikaIcon,
} from '../components/AppSidebar/navigationConfig';
import { AppIcon } from '../components/AppIcon/AppIcon';
import { inboxItemsStore, useAppSnapshots, appIdOf, appItemId } from './barItems';

/** Where an Inbox app entry opens: the chat panel, directory still alongside. */
export const inboxAppPath = (appId: string): string => `/chat/dir/app/${appId}`;

// Adapts AppIcon (which takes the icon `name`) to the PikaIcon shape the Inbox
// rows render, so an app row draws exactly like a built-in one.
const appNavIcon = (icon: string | null): PikaIcon => {
  const Icon = ({ variant: _variant, ...props }: PikaIconProps): ReactElement =>
    createElement(AppIcon, { name: icon, ...props });
  Icon.displayName = 'InboxAppIcon';
  return Icon;
};

/**
 * The Inbox menubar in the user's order: built-in entries from CHAT_NAV_ITEMS
 * and artifact apps, as `inboxItemsStore` lists them. Radar is still gated by
 * its flag even if the stored list names it. Ids that resolve to nothing are
 * skipped so a removed app or unknown key never renders a blank row.
 */
export const useInboxNavItems = (radarEnabled: boolean): ChatNavItem[] => {
  const ids = inboxItemsStore.useItems();
  const snapshots = useAppSnapshots();

  return useMemo(() => {
    const byKey = new Map<string, ChatNavItem>(CHAT_NAV_ITEMS.map(item => [item.key, item]));
    const items: ChatNavItem[] = [];
    for (const id of ids) {
      const appId = appIdOf(id);
      if (appId) {
        const snapshot = snapshots.get(appId);
        if (!snapshot) continue;
        items.push({
          key: appItemId(appId),
          label: snapshot.title,
          to: inboxAppPath(appId),
          icon: appNavIcon(snapshot.icon),
          trackName: 'OPEN_APP',
        });
        continue;
      }
      const item = byKey.get(id);
      if (!item) continue;
      if (item.requiresRadar && !radarEnabled) continue;
      items.push(item);
    }
    return items;
  }, [ids, snapshots, radarEnabled]);
};
