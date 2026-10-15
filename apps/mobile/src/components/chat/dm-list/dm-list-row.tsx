import { memo, type ReactElement } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import type { DmListItemData } from '@/src/types/dm-list-item';

import { DmListItem } from './dm-list-item';
import { DmListItemContextMenu } from './dm-list-item-context-menu';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { haptics } from '@/src/utils/haptics';

type DmListRowProps = {
  item: DmListItemData;
  onSelect?: ((channelId: string) => void) | undefined;
  onToggleStar: (channelId: string) => void;
  onMarkAsRead: (channelId: string) => void;
  onArchive: (channelId: string) => void;
};

function DmListRowComponent({
  item,
  onSelect,
  onToggleStar,
  onMarkAsRead,
  onArchive,
}: DmListRowProps): ReactElement {
  const router = useRouter();

  return (
    <DmListItemContextMenu
      item={item}
      onToggleStar={onToggleStar}
      onMarkAsRead={onMarkAsRead}
      onArchive={onArchive}
    >
      <DmListItem
        data={item}
        onPress={() => {
          void haptics.buttonTap();
          if (onSelect) {
            onSelect(item.id);
            return;
          }
          openBaseChatRoute(router, item.id, {
            surface: 'dms',
            unreadCount: item.unreadCount,
            unreadLastViewedAt: item.lastViewedAt,
            unreadLastViewedConversationId: item.lastViewedConversationId,
          });
        }}
      >
        <View className='flex-row items-center px-3 py-[10px]'>
          <DmListItem.Profile />
          <View className='flex-1 min-w-0 ml-3'>
            <View className='flex-row items-start justify-between gap-2'>
              <View className='flex-row items-center justify-start gap-1 max-w-[80%]'>
                <DmListItem.Name />
                <DmListItem.StatusEmoji />
              </View>
              <View className='flex-row items-center gap-1 shrink-0'>
                <DmListItem.Timestamp />
              </View>
            </View>
            <View className='flex-row items-center justify-between gap-2 mt-0.5'>
              <DmListItem.PreviewMessage />
              <View className='ml-auto min-w-0 flex-row items-center gap-2'>
                <DmListItem.Starred />
                <DmListItem.UnreadCount />
              </View>
            </View>
          </View>
        </View>
      </DmListItem>
    </DmListItemContextMenu>
  );
}

// Default shallow compare is enough now. `item` identity is stable per channel
// (see reconcileDmRow) and the action callbacks are useCallback'd in
// useDmListSwipeActions, so an unchanged row bails out on reference equality.
export const DmListRow = memo(DmListRowComponent);
