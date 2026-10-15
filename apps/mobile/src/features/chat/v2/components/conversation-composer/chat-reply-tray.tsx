import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

const AVATAR_SIZE = 18;
const AVATAR_OVERLAP = -4;
const MAX_VISIBLE_AVATARS = 3;

type ChatReplyTrayProps = {
  replyCount: number;
  replierUserIds?: readonly string[] | undefined;
  className?: string | undefined;
  accentColor?: string | undefined;
};

const getVisibleRepliers = (
  replierUserIds: readonly string[] | undefined,
  replyCount: number,
): Array<string | null> => {
  if (replyCount <= 0) return [];

  const concreteIds =
    replierUserIds
      ?.filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)
      .slice(-MAX_VISIBLE_AVATARS) ?? [];
  const visibleCount =
    concreteIds.length > 0 ? concreteIds.length : Math.min(replyCount, MAX_VISIBLE_AVATARS);

  return Array.from({ length: visibleCount }, (_, index) => concreteIds[index] ?? null);
};

const ChatReplyTrayComponent = ({
  replyCount,
  replierUserIds,
  className,
  accentColor,
}: ChatReplyTrayProps): ReactElement | null => {
  const { accentText: actionPrimaryColor } = useBubbleAccent();
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;
  const resolvedAccentColor = accentColor ?? actionPrimaryColor;
  const visibleRepliers = getVisibleRepliers(replierUserIds, replyCount);

  if (replyCount <= 0) return null;

  return (
    <View className={cn('shrink-0 flex-row items-center gap-1.5', className)}>
      {visibleRepliers.length > 0 ? (
        <View className='flex-row items-center'>
          {visibleRepliers.map((userId, index) => (
            <View
              key={userId ?? `reserved-${index}`}
              style={{
                marginLeft: index === 0 ? 0 : AVATAR_OVERLAP,
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
              }}
            >
              {userId ? (
                <Avatar userIds={[userId]} size={AVATAR_SIZE} />
              ) : (
                <View
                  style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: AVATAR_SIZE / 2,
                    backgroundColor: resolvedAccentColor || mutedForeground,
                    opacity: 0.45,
                  }}
                />
              )}
            </View>
          ))}
        </View>
      ) : null}
      <Text
        className='shrink-0 text-sm font-medium'
        style={{ color: resolvedAccentColor }}
        numberOfLines={1}
      >
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </Text>
      <View className='shrink-0 items-center justify-center'>
        <ChevronRight size={16} color={resolvedAccentColor} />
      </View>
    </View>
  );
};

export const ChatReplyTray = memo(ChatReplyTrayComponent);
ChatReplyTray.displayName = 'ChatReplyTray';
