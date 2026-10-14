import { memo, type ReactElement } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { useUser } from '@/src/hooks/useUsers';

import type { MessageRowModel } from '../model/chatRow.types';
import { REACTION_ROW_HEIGHT } from '../model/measureRowHeight';

/** v2 parity: `size={24}` with a matching `h-6 w-6` spacer when hidden. */
export const AVATAR_SIZE = 24;

const MessageAvatar = memo(function MessageAvatar({
  model,
  onPress,
}: {
  model: MessageRowModel;
  onPress: (event: GestureResponderEvent) => void;
}): ReactElement {
  const user = useUser(model.sender.senderId);
  const displayName = user?.name ?? model.sender.displayName;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${displayName} profile actions`}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }): { opacity: number } | null => (pressed ? { opacity: 0.7 } : null)}
    >
      <Avatar
        userIds={[model.sender.senderId]}
        size={AVATAR_SIZE}
        fallbackUsers={[
          {
            id: model.sender.senderId,
            name: displayName,
            picture: user?.picture ?? model.sender.avatarUri,
          },
        ]}
      />
    </Pressable>
  );
});
MessageAvatar.displayName = 'MessageAvatar';

/**
 * The avatar column — a **sibling** of the bubble in the row, bottom-aligned
 * (`items-end`), exactly as v2's `message-row.tsx` lays it out. The spacer keeps
 * grouped messages aligned when the avatar is suppressed, and the bottom margin
 * lifts the avatar clear of the reaction pills that render below the bubble.
 */
export function MessageRowAvatar({
  model,
  hasReactions,
  onPress,
}: {
  model: MessageRowModel;
  hasReactions: boolean;
  onPress: (event: GestureResponderEvent) => void;
}): ReactElement {
  return (
    <View style={hasReactions ? { marginBottom: REACTION_ROW_HEIGHT } : undefined}>
      {model.showAvatar ? (
        <MessageAvatar model={model} onPress={onPress} />
      ) : (
        <View className='h-6 w-6' />
      )}
    </View>
  );
}
