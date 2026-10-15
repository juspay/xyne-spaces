import type { ReactElement } from 'react';

import type { DmListItemData } from '@/src/types/dm-list-item';

import type { DmListItemRootProps } from './dm-list-item';

export type DmListItemContextMenuProps = {
  item: DmListItemData;
  children: ReactElement<DmListItemRootProps>;
  onToggleStar: (channelId: string) => void;
  onMarkAsRead: (channelId: string) => void;
  onArchive: (channelId: string) => void;
};

export type DmListContextMenuAction = {
  id: 'read' | 'star' | 'archive';
  label: string;
  systemImage: 'envelope.open' | 'star' | 'star.fill' | 'archivebox';
};

export function getDmListContextMenuActions(item: DmListItemData): DmListContextMenuAction[] {
  const hasUnread = (item.unreadCount ?? 0) > 0;
  const isStarred = item.isStarred ?? false;
  const actions: DmListContextMenuAction[] = [];

  if (hasUnread) {
    actions.push({
      id: 'read',
      label: 'Mark as read',
      systemImage: 'envelope.open',
    });
  }

  actions.push({
    id: 'star',
    label: isStarred ? 'Unstar' : 'Star',
    systemImage: isStarred ? 'star.fill' : 'star',
  });

  actions.push({
    id: 'archive',
    label: 'Archive',
    systemImage: 'archivebox',
  });

  return actions;
}
