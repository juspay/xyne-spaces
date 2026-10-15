import { type ReactElement } from 'react';
import { Image, Text } from 'react-native';

import { useMtlsEmoji } from '@/src/hooks/useMtlsEmoji';
import { INLINE_EMOJI_RESERVED_WIDTH_PX } from '../model/buildBody';

type CustomEmojiProps = {
  emojiId: string;
  name: string;
  uri?: string;
  size?: number;
};

/**
 * Key this component by `emojiId` at the call site so recycle does not paint
 * the previous emoji for a frame. `useMtlsEmoji` seeds from the session cache.
 */
export function CustomEmoji({
  emojiId,
  name,
  uri,
  size = INLINE_EMOJI_RESERVED_WIDTH_PX,
}: CustomEmojiProps): ReactElement {
  const fetched = useMtlsEmoji(uri ? undefined : emojiId);
  const resolved = uri ?? fetched.uri;
  if (!resolved) {
    return (
      <Text
        accessibilityLabel={name}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(10, size * 0.35),
          lineHeight: size,
        }}
      >
        :{name}:
      </Text>
    );
  }
  return (
    <Image
      accessibilityLabel={name}
      source={{ uri: resolved }}
      style={{ width: size, height: size }}
    />
  );
}
