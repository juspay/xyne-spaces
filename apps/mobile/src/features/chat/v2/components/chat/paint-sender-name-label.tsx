import { memo, type ReactElement } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { useUser } from '@/src/hooks/useUsers';
import { cn } from '@/src/utils/cn';
import { getActiveUserStatusEmoji } from '@/src/utils/statusUtils';

type PaintSenderNameLabelProps = {
  senderId: string;
  displayName: string;
  color: string;
  className?: string;
  onPress?: (event: GestureResponderEvent) => void;
};

const PaintSenderNameLabel = memo(function PaintSenderNameLabel({
  senderId,
  displayName,
  color,
  className,
  onPress,
}: PaintSenderNameLabelProps): ReactElement {
  const sender = useUser(senderId);
  const statusEmoji = getActiveUserStatusEmoji(sender);

  return (
    <View className={cn('mb-2 flex-row items-center gap-1.5', className)}>
      <Text
        className='min-w-0 shrink text-sm font-semibold'
        style={{ color }}
        numberOfLines={1}
        onPress={onPress}
      >
        {displayName}
      </Text>
      {statusEmoji ? (
        <View className='shrink-0'>
          <ReactionEmojiDisplay emojiName={statusEmoji} size={16} />
        </View>
      ) : null}
    </View>
  );
});

export { PaintSenderNameLabel };
