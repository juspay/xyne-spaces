import { LegendList } from '@legendapp/list/react-native';
import { useCallback, useMemo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import type { MentionListItem } from '@/src/components/input-composer/utils/mentions';

import {
  MENTIONS_CARD_ENTER_MS,
  MENTIONS_CARD_ENTER_OFFSET,
  MENTIONS_CARD_ENTER_SCALE,
  MENTIONS_CARD_EXIT_MS,
  MENTIONS_CARD_PADDING,
  MENTIONS_CARD_RADIUS,
  MENTIONS_CARD_ROW_HEIGHT,
  MENTIONS_CARD_ROW_PADDING_X,
  TRAY_SHADOW,
} from '../constants';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import { mentionsCardEmptyLabel, mentionsCardListHeight } from '../model/mentions-card';
import { colorOf } from '../model/token-color';
import { MentionRow } from './mention-row';

const { entering, exiting } = fadeScaleTransition({
  enterMs: MENTIONS_CARD_ENTER_MS,
  exitMs: MENTIONS_CARD_EXIT_MS,
  scale: MENTIONS_CARD_ENTER_SCALE,
  offsetY: MENTIONS_CARD_ENTER_OFFSET,
  enterEasing: Easing.out(Easing.cubic),
  exitEasing: Easing.in(Easing.cubic),
});

const keyOf = (item: MentionListItem): string => item.id;

type MentionsCardProps = {
  items: readonly MentionListItem[];
  isChannelMode: boolean;
  query: string;
  /** The most the card may take, padding included. */
  maxHeight: number;
  onPick: (item: MentionListItem) => void;
};

/**
 * The @ / # suggestions over the typing bar, in the "+" tray's card language.
 * Rows scroll inside it, virtualised as the classic list is, since a person
 * search is not capped; taps land without dropping the keyboard.
 */
export function MentionsCard({
  items,
  isChannelMode,
  query,
  maxHeight,
  onPick,
}: MentionsCardProps): ReactElement {
  const iconColor = colorOf(useCSSVariable('--color-spaces-foreground'));
  const listHeight = mentionsCardListHeight(items.length, maxHeight);
  const listStyle = useMemo(() => ({ height: listHeight }), [listHeight]);

  const renderItem = useCallback(
    ({ item }: { item: MentionListItem }): ReactElement => (
      <MentionRow item={item} query={query} iconColor={iconColor} onPick={onPick} />
    ),
    [iconColor, onPick, query],
  );

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      className='bg-spaces-surface-raised'
      style={styles.card}
    >
      {/* A separate clip, because clipping the shadowed view would clip its shadow on iOS. */}
      <View style={styles.clip}>
        {items.length === 0 ? (
          <View className='justify-center' style={styles.empty}>
            <Text className='text-[14px] leading-[20px] text-spaces-muted'>
              {mentionsCardEmptyLabel(isChannelMode)}
            </Text>
          </View>
        ) : (
          <LegendList
            style={listStyle}
            data={items}
            extraData={query}
            keyExtractor={keyOf}
            renderItem={renderItem}
            estimatedItemSize={MENTIONS_CARD_ROW_HEIGHT}
            keyboardShouldPersistTaps='handled'
            bounces={false}
            overScrollMode='never'
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: MENTIONS_CARD_RADIUS, transformOrigin: 'bottom', ...TRAY_SHADOW },
  clip: {
    borderRadius: MENTIONS_CARD_RADIUS,
    overflow: 'hidden',
    padding: MENTIONS_CARD_PADDING,
  },
  empty: { height: MENTIONS_CARD_ROW_HEIGHT, paddingHorizontal: MENTIONS_CARD_ROW_PADDING_X },
});
