import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { Lock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { withAlpha } from '@/src/utils/color';
import { HighlightedText } from '../highlighted-text';
import type { SearchInTargetItem } from '../../types';

type SearchInTargetRowProps = {
  item: SearchInTargetItem;
  query: string;
  onPress?: (item: SearchInTargetItem) => void;
};

/**
 * `in:` typeahead row — channels use #/lock, DMs use avatars.
 */
export const SearchInTargetRow = memo(function SearchInTargetRow({
  item,
  query,
  onPress,
}: SearchInTargetRowProps): ReactElement {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-text') as string;
  const borderColor = withAlpha(foregroundColor, 0.08);
  const isPrivate = item.visibility === 'PRIVATE' || item.visibility === 'private';
  const isDm = item.kind === 'dm';

  return (
    <Pressable
      accessibilityRole='button'
      className='flex-row items-center px-4 py-2.5 bg-tabs-screen'
      onPress={() => onPress?.(item)}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
    >
      {isDm && item.avatarUserIds && item.avatarUserIds.length > 0 ? (
        <Avatar userIds={item.avatarUserIds} size={48} />
      ) : (
        <View className='size-12 items-center justify-center rounded-full bg-input'>
          {isPrivate ? (
            <Lock size={18} color={mutedColor} />
          ) : (
            <Text className='text-xl font-semibold text-secondary-text'>#</Text>
          )}
        </View>
      )}
      <View className='ml-3 min-w-0 flex-1 flex-row items-center gap-1.5'>
        <HighlightedText
          value={item.title}
          query={query}
          className='shrink text-base font-semibold text-foreground'
        />
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
