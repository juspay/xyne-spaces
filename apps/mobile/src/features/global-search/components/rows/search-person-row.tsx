import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { withAlpha } from '@/src/utils/color';
import { HighlightedText } from '../highlighted-text';
import type { SearchPersonItem } from '../../types';

type SearchPersonRowProps = {
  item: SearchPersonItem;
  query: string;
  onPress?: (item: SearchPersonItem) => void;
};

export const SearchPersonRow = memo(function SearchPersonRow({
  item,
  query,
  onPress,
}: SearchPersonRowProps): ReactElement {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const borderColor = withAlpha(foregroundColor, 0.08);

  return (
    <Pressable
      accessibilityRole='button'
      className='flex-row items-center px-4 py-2.5 bg-tabs-screen'
      onPress={() => onPress?.(item)}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
    >
      <Avatar userIds={[item.id]} size={48} />
      <View className='ml-3 min-w-0 flex-1'>
        <View className='flex-row items-center gap-1'>
          <HighlightedText
            value={item.title}
            query={query}
            className='shrink text-base font-semibold text-foreground'
          />
          {item.statusEmoji ? (
            <ReactionEmojiDisplay emojiName={item.statusEmoji} size={15} />
          ) : null}
        </View>
        {item.subtitle ? (
          <HighlightedText
            value={item.subtitle}
            query={query}
            className='mt-0.5 text-sm text-secondary-text'
          />
        ) : null}
      </View>
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
