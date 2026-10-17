import { memo, useCallback } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { cn } from '@/src/utils/cn';

import { DESK_LIST_AVATAR_SIZE, DESK_LIST_ROW_HEIGHT } from '../../constants';
import type { DeskListItemData } from '../../types';
import { formatDeskTypeLabel, getDeskAvatarColor, getDeskInitial } from '../../utils';
import { withAlpha } from '@/src/utils/color';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

type DesksListItemProps = {
  data: DeskListItemData;
  isJoining: boolean;
  onJoin: (channelId: string, channelName: string) => void;
};

export const DesksListItem = memo(function DesksListItem({
  data,
  isJoining,
  onJoin,
}: DesksListItemProps) {
  const router = useRouter();
  const primaryForeground = useCSSVariable('--color-primary-foreground') as string;

  const typeLabel = formatDeskTypeLabel(data.type);
  const initial = getDeskInitial(data.name);
  const avatarColor = getDeskAvatarColor(data.id || data.name);

  const handlePress = useCallback(() => {
    // Not-joined desks stay on the list — join first, then open.
    if (!data.isJoined) return;
    router.push(`/xyne-desks/${data.id}`);
  }, [router, data.id, data.isJoined]);

  const handleJoinPress = useCallback(() => {
    onJoin(data.id, data.name);
  }, [onJoin, data.id, data.name]);

  const { accentBg: greenBg } = useBubbleAccent();
  const deskLabelBg = withAlpha(greenBg, 0.1);
  const deskLabelText = withAlpha(greenBg, 0.8);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={data.isJoined ? data.name : `${data.name}, not joined`}
      onPress={handlePress}
      style={{ height: DESK_LIST_ROW_HEIGHT }}
      className={cn('flex-row items-center gap-3 px-4', data.isJoined && 'active:opacity-80')}
    >
      <View
        className='items-center justify-center rounded-[10px]'
        style={{
          width: DESK_LIST_AVATAR_SIZE,
          height: DESK_LIST_AVATAR_SIZE,
          backgroundColor: avatarColor,
        }}
      >
        <Text className='text-[17px] font-semibold text-white'>{initial}</Text>
      </View>

      <View className='min-w-0 flex-1'>
        <View className='flex-row items-center gap-2'>
          <Text
            className='min-w-0 flex-1 text-[16px] font-semibold text-foreground'
            numberOfLines={1}
            ellipsizeMode='tail'
          >
            {data.name}
          </Text>
          <View
            className='shrink-0 rounded-md px-1.5 py-0.5'
            style={{ backgroundColor: deskLabelBg }}
          >
            <Text className='text-[11px] font-medium' style={{ color: deskLabelText }}>
              {typeLabel}
            </Text>
          </View>
        </View>
        {data.description ? (
          <Text className='mt-0.5 text-[13px] text-foreground/60' numberOfLines={1}>
            {data.description}
          </Text>
        ) : null}
      </View>

      {/* Joined → render nothing on the right (Gmail trailing-action parity). */}
      {!data.isJoined ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Join ${data.name}`}
          disabled={isJoining}
          hitSlop={8}
          onPress={handleJoinPress}
          className={cn(
            'h-8 min-w-16 items-center justify-center rounded-full px-3.5',
            'bg-muted',
            isJoining && 'opacity-70',
          )}
        >
          {isJoining ? (
            <ActivityIndicator size='small' color={primaryForeground} />
          ) : (
            <Text className='text-[13px] font-semibold text-white'>Join</Text>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
});
