import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Star } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { TICKET_STAR_FILLED } from '../../../detail/constants';
import {
  TICKET_LIST_AVATAR_SIZE,
  TICKET_LIST_CARD_HEIGHT,
  TICKET_LIST_H_INSET,
  TICKET_LIST_ROW_HEIGHT,
} from '../../constants';
import type { TicketListItemData, TicketListItemPosition } from '../../types';
import {
  formatTicketListTimestamp,
  getTicketAvatarColor,
  getTicketAvatarInitial,
  getTicketListItemBorderRadius,
} from '../../utils';

type TicketsListItemProps = {
  data: TicketListItemData;
  channelId: string;
  position: TicketListItemPosition;
  /** EMAIL desks only — hide on APP/SLACK. */
  showStar: boolean;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEnterSelection: (id: string) => void;
};

export const TicketsListItem = memo(function TicketsListItem({
  data,
  channelId,
  position,
  showStar,
  isSelecting,
  isSelected,
  onToggleSelect,
  onEnterSelection,
}: TicketsListItemProps) {
  const router = useRouter();
  const foreground = useCSSVariable('--color-foreground') as string;
  const selectedAvatar = useCSSVariable('--color-neutral-700') as string;
  const checkColor = useCSSVariable('--color-accent-foreground') as string;

  const initial = getTicketAvatarInitial(data.senderName);
  const avatarColor = getTicketAvatarColor(data.senderName || data.id);
  const timeLabel = formatTicketListTimestamp(data.lastEmailAt);
  const borderRadius = useMemo(() => getTicketListItemBorderRadius(position), [position]);

  const handlePress = useCallback(() => {
    if (isSelecting) {
      void haptics.selection();
      onToggleSelect(data.id);
      return;
    }
    void haptics.buttonTap();
    // Pass internal UUID as ?id= so detail prefers id lookup (dashboard parity).
    router.push(`/xyne-desks/${channelId}/${data.xyneId}?id=${encodeURIComponent(data.id)}`);
  }, [isSelecting, onToggleSelect, data.id, data.xyneId, channelId, router]);

  const handleLongPress = useCallback(() => {
    void haptics.longPress();
    if (isSelecting) {
      onToggleSelect(data.id);
      return;
    }
    onEnterSelection(data.id);
  }, [isSelecting, onToggleSelect, onEnterSelection, data.id]);

  return (
    <View style={{ height: TICKET_LIST_ROW_HEIGHT, paddingHorizontal: TICKET_LIST_H_INSET }}>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ selected: isSelected }}
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={280}
        className={cn(
          'flex-row gap-3 px-3 py-2.5 bg-card',
          isSelected && 'bg-neutral-200 dark:bg-accent/60',
        )}
        style={{
          height: TICKET_LIST_CARD_HEIGHT,
          ...borderRadius,
          overflow: 'hidden',
        }}
      >
        <View
          className='items-center justify-center rounded-full'
          style={{
            width: TICKET_LIST_AVATAR_SIZE,
            height: TICKET_LIST_AVATAR_SIZE,
            backgroundColor: isSelected ? selectedAvatar : avatarColor,
          }}
        >
          {isSelected ? (
            <Check size={18} color={checkColor} strokeWidth={2.75} />
          ) : (
            <Text className='text-[15px] font-semibold text-white'>{initial}</Text>
          )}
        </View>

        <View className='min-w-0 flex-1'>
          <View className='flex-row items-center gap-2'>
            <Text
              className={cn(
                'min-w-0 flex-1 text-[15px]',
                data.isUnread ? 'font-bold text-foreground' : 'font-medium text-foreground/80',
              )}
              numberOfLines={1}
            >
              {data.senderName}
            </Text>
            <Text
              className={cn(
                'text-[12px] text-foreground/80',
                data.isUnread ? 'font-bold' : 'font-medium',
              )}
            >
              {timeLabel}
            </Text>
            {data.isUnread && !isSelected ? (
              <View className='size-1.5 rounded-full bg-foreground' />
            ) : null}
          </View>

          <Text
            className={cn(
              'mt-0.5 text-[14px]',
              data.isUnread ? 'font-semibold text-foreground' : 'font-normal text-foreground/80',
            )}
            numberOfLines={1}
          >
            {data.title}
          </Text>

          <View className='mt-0.5 flex-row items-end gap-2'>
            <Text className='min-w-0 flex-1 text-[13px] text-foreground/70' numberOfLines={1}>
              {data.snippet}
            </Text>
            {showStar ? (
              <Star
                size={16}
                color={data.isStarred ? TICKET_STAR_FILLED : foreground}
                fill={data.isStarred ? TICKET_STAR_FILLED : 'transparent'}
              />
            ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
});
