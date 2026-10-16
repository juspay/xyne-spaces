import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { parseRepliesMd } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import { cn } from '@/src/utils/cn';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import Avatar from '../ui/avatar';

const AVATAR_SIZE = 18;

type RepliesProps = {
  className?: string;
};

const Replies = memo(({ className }: RepliesProps): ReactElement | null => {
  const { accentText } = useBubbleAccent();
  chatOpenProfiler.count('replies_component_render');
  const { item, paintRow, parentMessage } = useConversationComposer();
  const actionPrimaryColor = useCSSVariable('--color-action-primary') as string;

  const replyCount = parentMessage ? 0 : (paintRow?.replyCount ?? item.replyCount ?? 0);
  if (replyCount <= 0) return null;
  chatOpenProfiler.count('replies_component_non_empty');

  const latestReplierIds = paintRow?.replyPreviewUserIds?.length
    ? paintRow.replyPreviewUserIds.slice(-3)
    : parseRepliesMd(item.replies_md ?? null).repliers.slice(-3);
  const reservedAvatarCount =
    latestReplierIds.length > 0 ? latestReplierIds.length : Math.min(replyCount, 3);

  return (
    <DebugBoundary>
      <View className={cn('shrink-0 flex-row items-center gap-1.5', className)}>
        {reservedAvatarCount > 0 ? (
          <View className='flex-row items-center'>
            {Array.from({ length: reservedAvatarCount }).map((_, idx) => {
              const userId = latestReplierIds[idx] ?? `reserved-${idx}`;
              return (
                <View key={userId} style={{ marginLeft: idx === 0 ? 0 : -4 }}>
                  <Avatar userIds={[userId]} size={AVATAR_SIZE} />
                </View>
              );
            })}
          </View>
        ) : null}
        <Text
          className='shrink-0 text-sm font-medium'
          style={{ color: accentText }}
          numberOfLines={1}
        >
          {replyCount} {replyCount > 1 ? 'replies' : 'reply'}
        </Text>
        <View className='flex shrink-0 items-center justify-center'>
          <ChevronRight size={16} color={actionPrimaryColor} />
        </View>
      </View>
    </DebugBoundary>
  );
});
Replies.displayName = 'ConversationComposer.Replies';

export { Replies };
