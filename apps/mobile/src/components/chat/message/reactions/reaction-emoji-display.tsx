import { Text, View } from 'react-native';
import type { ReactElement } from 'react';
import { Image } from 'expo-image';
import { parseCustomEmoji } from '@/src/utils/customEmoji';
import { useMtlsEmoji } from '@/src/hooks/useMtlsEmoji';

type ReactionEmojiDisplayProps = {
  emojiName: string;
  size?: number;
  hydrateCustomEmoji?: boolean;
};

/**
 * Custom reaction keys are `custom:{emojiId}:{name}`. Images load from
 * `/api/emojis/:id/stream` via mTLS-authenticated fetch + local file cache,
 * which works in both local and production environments.
 */
export function ReactionEmojiDisplay({
  emojiName,
  size = 22,
  hydrateCustomEmoji = true,
}: ReactionEmojiDisplayProps): ReactElement {
  const custom = parseCustomEmoji(emojiName);
  const { uri } = useMtlsEmoji(hydrateCustomEmoji ? custom?.emojiId : undefined);
  const fallbackLabel = custom?.name?.trim().charAt(0).toUpperCase() || '?';

  if (custom) {
    if (hydrateCustomEmoji && uri) {
      return (
        <View style={{ width: size, height: size }} accessibilityLabel={`:${custom.name}:`}>
          <Image
            source={{ uri }}
            style={{ width: size, height: size }}
            contentFit='contain'
            cachePolicy='memory-disk'
            recyclingKey={custom.emojiId}
          />
        </View>
      );
    }

    // Keep the reaction footprint visible while a custom emoji is deferred/loading.
    return (
      <View
        className='bg-muted items-center justify-center rounded-full'
        style={{ width: size, height: size }}
        accessibilityLabel={`:${custom.name}:`}
      >
        <Text
          className='text-muted-foreground font-semibold'
          style={{ fontSize: Math.max(9, Math.floor(size * 0.55)), lineHeight: size }}
          numberOfLines={1}
        >
          {fallbackLabel}
        </Text>
      </View>
    );
  }

  return (
    <Text style={{ fontSize: size }} accessibilityLabel={emojiName}>
      {emojiName}
    </Text>
  );
}
