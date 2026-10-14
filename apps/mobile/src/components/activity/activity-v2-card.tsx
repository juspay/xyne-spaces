import { memo, type ReactElement, type ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { ListRowPressable } from '@/src/components/ui/list-row-pressable';
import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { useActivityRenderContext } from '@/src/components/activity/activity-v2/activity-render-context';
import {
  navigateToActivityTarget,
  type ActivityRowVM,
} from '@/src/features/activity/presentation/activityRowAssembler';
import type { ActivityWithRelated } from '@/src/types/activity';

type ActivityV2CardProps = {
  activity: ActivityWithRelated;
  rowVm?: ActivityRowVM;
  actorId?: string | undefined;
  actorName?: string | undefined;
  channelId?: string | undefined;
  channelLabel?: string | undefined;
  badgeIcon: ReactNode;
  badgeColorClass?: string | undefined;
  badgeStyle?: StyleProp<ViewStyle> | undefined;
  description?: string;
  onPress?: () => void;
  children: ReactNode;
  hideChannel?: boolean;
};

type ActivityChannelFallback = {
  channel?: {
    name?: string | null;
  } | null;
};

const ActivityV2CardInner = ({
  activity,
  rowVm,
  actorId,
  actorName,
  channelId: _channelId,
  channelLabel,
  badgeIcon,
  badgeColorClass,
  badgeStyle,
  description,
  onPress,
  children,
  hideChannel = false,
}: ActivityV2CardProps): ReactElement => {
  const zero = useZero();
  const renderContext = useActivityRenderContext();
  const resolvedRowVm = rowVm ?? renderContext.rowVm;
  const resolvedActorId = actorId || resolvedRowVm.actorId || '';
  const resolvedActorName = actorName || resolvedRowVm.actorName || 'Someone';
  const resolvedDescription = description || resolvedRowVm.description;
  const fallbackChannelName = (activity as ActivityChannelFallback).channel?.name ?? undefined;
  const displayChannelName = channelLabel || resolvedRowVm.channelLabel || fallbackChannelName;
  const activityDivider = useCSSVariable('--color-activity-divider') as string;
  const activityCardBg = useCSSVariable('--color-activity-v2-card-bg') as string;
  const activityCardUnreadBg = useCSSVariable('--color-activity-v2-card-unread-bg') as string;
  const handlePress = (): void => {
    // No tap haptic here — ListRowPressable already fires one on press-in.
    if (resolvedRowVm.isUnread) {
      void zero.mutate(mutators.activities.markAsRead({ activityId: resolvedRowVm.id }));
    }
    if (onPress) {
      onPress();
      return;
    }

    navigateToActivityTarget(resolvedRowVm.navigationTarget);
  };

  const isUnread = resolvedRowVm.isUnread;

  return (
    <ListRowPressable
      onPress={handlePress}
      className='px-4 pt-2'
      backgroundColor={isUnread ? activityCardUnreadBg : activityCardBg}
    >
      <View className='flex-row items-start gap-2 pb-2'>
        {/* Left — action badge */}
        <View className='relative shrink-0'>
          <View
            className={cn(
              'w-7 h-7 rounded-full items-center justify-center',
              badgeColorClass ?? 'bg-card',
            )}
            style={badgeStyle}
          >
            {badgeIcon}
          </View>
        </View>

        {/* Right — actor avatar + title row + content */}
        <View className='flex-1 gap-0.5'>
          {resolvedActorName ? (
            <View className='rounded-lg overflow-hidden self-start'>
              <Avatar
                userIds={resolvedActorId ? [resolvedActorId] : []}
                size={32}
                rounded={false}
              />
            </View>
          ) : null}

          <View className='flex-row items-start justify-between gap-2'>
            <Text
              className='flex-1 text-[14px]'
              style={{ lineHeight: 20 }}
              numberOfLines={2}
              ellipsizeMode='tail'
            >
              <Text className='font-semibold text-activity-heading'>{resolvedActorName}</Text>
              <Text className='font-medium text-activity-heading'>{` ${resolvedDescription}`}</Text>
              {!hideChannel && displayChannelName ? (
                <Text className='font-semibold text-activity-heading'>{` #${displayChannelName}`}</Text>
              ) : null}
            </Text>
            <Text className='shrink-0 text-[12px] font-medium text-activity-time'>
              {resolvedRowVm.timeLabel}
            </Text>
          </View>
          <View className='w-full'>{children}</View>
        </View>
      </View>
      <View
        pointerEvents='none'
        className='absolute left-0 right-0 bottom-0 h-px'
        style={{ backgroundColor: activityDivider }}
      />
    </ListRowPressable>
  );
};

export const ActivityV2Card = memo(ActivityV2CardInner);
