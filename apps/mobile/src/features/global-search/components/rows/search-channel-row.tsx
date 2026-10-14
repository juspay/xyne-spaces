import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { Lock, Star } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { withAlpha } from '@/src/utils/color';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { UnreadCountBadge } from '@/src/components/ui/unread-count-badge';
import { HighlightedText } from '../highlighted-text';
import type { SearchChannelItem } from '../../types';

type SearchChannelRowProps = {
  item: SearchChannelItem;
  query: string;
  onPress?: (item: SearchChannelItem) => void;
};

export const SearchChannelRow = memo(function SearchChannelRow({
  item,
  query,
  onPress,
}: SearchChannelRowProps): ReactElement {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-text') as string;
  const { accentText: brandColor } = useBubbleAccent();
  const borderColor = withAlpha(foregroundColor, 0.08);
  const isPrivate = item.visibility === 'PRIVATE' || item.visibility === 'private';

  return (
    <Pressable
      accessibilityRole='button'
      className='flex-row items-center px-4 py-2.5 bg-tabs-screen'
      onPress={() => onPress?.(item)}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
    >
      <View className='size-12 items-center justify-center rounded-full bg-input'>
        {isPrivate ? (
          <Lock size={18} color={mutedColor} />
        ) : (
          <Text className='text-xl font-semibold text-secondary-text'>#</Text>
        )}
      </View>
      <View className='ml-3 min-w-0 flex-1 flex-row items-center gap-1.5'>
        <HighlightedText
          value={item.title}
          query={query}
          className='shrink text-base font-semibold text-foreground'
        />
        {item.isStarred ? <Star size={14} color={brandColor} fill={brandColor} /> : null}
      </View>
      {item.unreadCount && item.unreadCount > 0 ? (
        <View className='ml-2'>
          <UnreadCountBadge count={item.unreadCount} />
        </View>
      ) : null}
      <View
        pointerEvents='none'
        className='absolute bottom-0 left-[76px] right-0'
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: borderColor,
        }}
      />
    </Pressable>
  );
});
