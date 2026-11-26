import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactElement,
} from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  BUBBLE_CLEAR_ALL_HEIGHT,
  BUBBLE_CLEAR_ALL_PADDING_X,
  BUBBLE_EDGE_INSET,
  BUBBLE_LIST_ENTER_MS,
  BUBBLE_LIST_ENTER_SCALE,
  BUBBLE_LIST_EXIT_MS,
  BUBBLE_LIST_GAP,
  BUBBLE_LIST_ROW_WIDTH,
  BUBBLE_LIST_SHADOW_ROOM,
  BUBBLE_SHADOW,
} from '../../constants';
import {
  bubbleListRowsMaxHeight,
  type BubbleListPlacement,
  type ParkedThread,
} from '../../model/bubbles';
import { fadeScaleTransition } from '../../model/fade-scale-transition';
import { ConversationScrim } from '../conversation-scrim';
import { BubbleListRow } from './bubble-list-row';

const TRANSITION = fadeScaleTransition({
  enterMs: BUBBLE_LIST_ENTER_MS,
  exitMs: BUBBLE_LIST_EXIT_MS,
  scale: BUBBLE_LIST_ENTER_SCALE,
});

type BubbleListProps = {
  parked: readonly ParkedThread[];
  placement: BubbleListPlacement;
  screenWidth: number;
  onOpen: (thread: ParkedThread) => void;
  onRemove: (threadId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
};

/**
 * The parked threads, opened from the bubble (Figma "8 · Tap: the list of
 * threads"): a pill per thread lined up with the bubble's side, newest
 * nearest it, then "Clear all", over the 20% scrim. It stays inside the safe
 * area: past the room it has, the rows scroll and "Clear all" stays put. A
 * modal for screen readers; the scrim, the bubble, back or Escape fold it.
 */
export function BubbleList({
  parked,
  placement,
  screenWidth,
  onOpen,
  onRemove,
  onClearAll,
  onClose,
}: BubbleListProps): ReactElement {
  const firstRef = useRef<ComponentRef<typeof View>>(null);
  const rowWidth = Math.min(BUBBLE_LIST_ROW_WIDTH, screenWidth - BUBBLE_EDGE_INSET * 2);
  const align = placement.side === 'left' ? 'flex-start' : 'flex-end';
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const rowsMaxHeight = bubbleListRowsMaxHeight(placement.maxHeight);
  // The rows clip only at their own ends, so scrolled rows never run under
  // the bubble or "Clear all"; the shadow room is sideways only.
  const clearSidePadding = placement.growsDown ? 'paddingBottom' : 'paddingTop';
  // Newest nearest the bubble: first at the top when the list grows down, last
  // at the bottom (scrolled into view) when it grows up.
  const rows = useMemo(
    () => (placement.growsDown ? parked : [...parked].reverse()),
    [parked, placement.growsDown],
  );
  const scrollToBubble = useCallback((): void => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  useEffect(() => {
    const first = firstRef.current;
    if (first !== null) AccessibilityInfo.sendAccessibilityEvent(first, 'focus');
  }, []);

  return (
    <>
      <Animated.View
        style={StyleSheet.absoluteFill}
        entering={TRANSITION.entering}
        exiting={TRANSITION.exiting}
      >
        <ConversationScrim label='Close parked threads' onPress={onClose} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        entering={TRANSITION.entering}
        exiting={TRANSITION.exiting}
        style={{
          position: 'absolute',
          [placement.side]: placement.sideInset,
          [placement.growsDown ? 'top' : 'bottom']: placement.edgeOffset,
          flexDirection: placement.growsDown ? 'column' : 'column-reverse',
          alignItems: align,
        }}
      >
        <ScrollView
          ref={scrollRef}
          style={{
            flexGrow: 0,
            maxHeight: rowsMaxHeight + BUBBLE_LIST_GAP,
            marginHorizontal: -BUBBLE_LIST_SHADOW_ROOM,
          }}
          contentContainerStyle={{
            paddingHorizontal: BUBBLE_LIST_SHADOW_ROOM,
            // The gap to "Clear all" is the rows' own padding, so a scrolled
            // row ends above it instead of under it.
            [clearSidePadding]: BUBBLE_LIST_GAP,
            rowGap: BUBBLE_LIST_GAP,
            alignItems: align,
          }}
          showsVerticalScrollIndicator={false}
          {...(placement.growsDown ? {} : { onContentSizeChange: scrollToBubble })}
        >
          {rows.map(thread => (
            <View
              key={thread.threadId}
              ref={thread.threadId === parked[0]?.threadId ? firstRef : undefined}
            >
              <BubbleListRow thread={thread} width={rowWidth} onOpen={onOpen} onRemove={onRemove} />
            </View>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Clear all parked threads'
          onPress={onClearAll}
          className='justify-center bg-spaces-surface-raised active:opacity-60'
          style={{
            height: BUBBLE_CLEAR_ALL_HEIGHT,
            borderRadius: BUBBLE_CLEAR_ALL_HEIGHT / 2,
            paddingHorizontal: BUBBLE_CLEAR_ALL_PADDING_X,
            boxShadow: BUBBLE_SHADOW,
          }}
        >
          <Text className='text-[14px] leading-5 tracking-[-0.14px] text-spaces-muted'>
            Clear all
          </Text>
        </Pressable>
      </Animated.View>
    </>
  );
}
