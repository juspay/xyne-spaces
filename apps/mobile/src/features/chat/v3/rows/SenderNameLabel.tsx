import { type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { useUser } from '@/src/hooks/useUsers';
import { getActiveUserStatusEmoji } from '@/src/utils/statusUtils';

import type { MessageRowModel } from '../model/chatRow.types';
import { useSenderColor } from './useSenderColor';

/**
 * v2 parity (`paint-sender-name-label.tsx`): `text-sm` name inside the bubble,
 * `mb-2` before the body, optional status emoji.
 */
export function SenderNameLabel({
  model,
  onPress,
}: {
  model: MessageRowModel;
  onPress: (event: GestureResponderEvent) => void;
}): ReactElement {
  const nameColor = useSenderColor(model.sender.colorIndex);
  const user = useUser(model.sender.senderId);
  const displayName = user?.name ?? model.sender.displayName;
  const statusEmoji = getActiveUserStatusEmoji(user);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${displayName} profile actions`}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }): { opacity: number } | null => (pressed ? { opacity: 0.7 } : null)}
    >
      <View className='mb-2 flex-row items-center gap-1.5'>
        <Text
          className='min-w-0 shrink text-sm font-semibold'
          numberOfLines={1}
          style={{ color: nameColor }}
        >
          {displayName}
        </Text>
        {statusEmoji ? (
          <View className='shrink-0'>
            <ReactionEmojiDisplay emojiName={statusEmoji} size={16} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
