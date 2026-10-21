import { ChevronRight } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';

const AVATAR_SIZE = 18;
const AVATAR_OVERLAP = -4;
const MAX_VISIBLE_AVATARS = 3;

const visibleRepliers = (
  replierUserIds: readonly string[] | undefined,
  replyCount: number,
): Array<string | null> => {
  if (replyCount <= 0) return [];
  const concreteIds = (replierUserIds ?? [])
    .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)
    .slice(-MAX_VISIBLE_AVATARS);
  const visibleCount =
    concreteIds.length > 0 ? concreteIds.length : Math.min(replyCount, MAX_VISIBLE_AVATARS);
  return Array.from({ length: visibleCount }, (_, index) => concreteIds[index] ?? null);
};

/**
 * v2 parity (`chat-reply-tray.tsx` / `PaintReplyTray`): overlapping 18px
 * replier avatars, "N replies", chevron. Placeholder discs fill when ids are
 * still loading so the tray width stays stable.
 */
export const MessageReplyTray = memo(function MessageReplyTray({
  replyCount,
  replierUserIds,
  accentColor,
}: {
  replyCount: number;
  replierUserIds: readonly string[];
  accentColor: string;
}): ReactElement | null {
  if (replyCount <= 0) return null;
  const repliers = visibleRepliers(replierUserIds, replyCount);

  return (
    <View className='shrink-0 flex-row items-center gap-1.5'>
      {repliers.length > 0 ? (
        <View className='flex-row items-center'>
          {repliers.map((userId, index) => (
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
                    backgroundColor: accentColor,
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
        style={{ color: accentColor }}
        numberOfLines={1}
      >
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </Text>
      <View className='shrink-0 items-center justify-center'>
        <ChevronRight size={16} color={accentColor} />
      </View>
    </View>
  );
});
