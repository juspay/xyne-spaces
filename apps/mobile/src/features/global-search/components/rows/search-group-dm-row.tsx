import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { Star } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { withAlpha } from '@/src/utils/color';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { HighlightedText } from '../highlighted-text';
import type { SearchGroupDmItem } from '../../types';

type SearchGroupDmRowProps = {
  item: SearchGroupDmItem;
  query: string;
  onPress?: (item: SearchGroupDmItem) => void;
};

/**
 * Group DM row for the DMs global-search tab (dashboard "Group DMs" section).
 */
export const SearchGroupDmRow = memo(function SearchGroupDmRow({
  item,
  query,
  onPress,
}: SearchGroupDmRowProps): ReactElement {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const { accentText: brandColor } = useBubbleAccent();
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
      <Avatar userIds={item.avatarUserIds} size={48} />
      <View className='ml-3 min-w-0 flex-1 flex-row items-center gap-1.5'>
        <HighlightedText
          value={item.title}
          query={query}
          className='shrink text-base font-semibold text-foreground'
        />
        {item.isStarred ? <Star size={14} color={brandColor} fill={brandColor} /> : null}
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
