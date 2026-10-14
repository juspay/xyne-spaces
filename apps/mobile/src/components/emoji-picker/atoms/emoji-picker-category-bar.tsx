import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import XyneAppIcon from '@/assets/images/Xyne_Spaces-Default-1024x1024.png';
import { EMOJI_PICKER_CATEGORY_BAR_HEIGHT } from '../emoji-picker.constants';
import { emojiPickerStyles } from '../emoji-picker.styles';
import type { EmojiCategoryBarItem } from '../emoji-picker.types';
import { logEmojiPickerDiagnostic } from '../emoji-picker-diagnostics';

type EmojiPickerCategoryBarProps = {
  items: EmojiCategoryBarItem[];
  traceId: string;
  activeCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
};

const EmojiPickerCategoryBar = memo(function EmojiPickerCategoryBar({
  items,
  traceId,
  activeCategoryId,
  onSelectCategory,
}: EmojiPickerCategoryBarProps): ReactElement {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === 'ios' ? insets.bottom : 0;
  const barHeight = EMOJI_PICKER_CATEGORY_BAR_HEIGHT + bottomPadding;
  const scrollRef = useRef<ScrollView>(null);
  const tabOffsets = useRef<Record<string, number>>({});
  const hasLoggedLayoutRef = useRef(false);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      if (hasLoggedLayoutRef.current) return;
      hasLoggedLayoutRef.current = true;
      logEmojiPickerDiagnostic(traceId, 'category_bar_layout', {
        height: Math.round(event.nativeEvent.layout.height),
      });
    },
    [traceId],
  );

  useEffect(() => {
    const x = tabOffsets.current[activeCategoryId];
    if (x === undefined) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [activeCategoryId]);

  return (
    <View
      className='border-t border-border bg-card'
      style={{ height: barHeight, flexShrink: 0, paddingBottom: bottomPadding }}
      onLayout={handleLayout}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        style={{ height: EMOJI_PICKER_CATEGORY_BAR_HEIGHT }}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{
          minHeight: EMOJI_PICKER_CATEGORY_BAR_HEIGHT,
          alignItems: 'center',
          paddingHorizontal: 8,
          gap: 2,
        }}
      >
        {items.map(item => {
          const isActive = item.id === activeCategoryId;
          return (
            <Pressable
              key={item.id}
              onLayout={event => {
                tabOffsets.current[item.id] = event.nativeEvent.layout.x;
              }}
              style={
                item.disabled
                  ? [emojiPickerStyles.categoryTab, { opacity: 0.4 }]
                  : emojiPickerStyles.categoryTab
              }
              {...(isActive ? { className: 'bg-accent' } : {})}
              onPress={() => onSelectCategory(item.id)}
              disabled={item.disabled}
              accessibilityRole='button'
              {...(item.useXyneIcon ? { accessibilityLabel: 'Custom emoji' } : {})}
              accessibilityState={{ selected: isActive, disabled: item.disabled }}
            >
              {item.useXyneIcon ? (
                <Image source={XyneAppIcon} style={emojiPickerStyles.xyneCategoryIcon} />
              ) : (
                <Text style={emojiPickerStyles.categoryIcon}>{item.icon}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

EmojiPickerCategoryBar.displayName = 'EmojiPickerCategoryBar';

export { EmojiPickerCategoryBar };
