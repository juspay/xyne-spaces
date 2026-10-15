import { type ReactElement } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/src/utils/haptics';
import { TAB_CATALOG } from '@/src/features/bottom-navigation/model/catalog';
import { BOUNDARY_ID, moveInDragOrder } from '@/src/features/bottom-navigation/model/layout';
import { CustomizeRow, type CustomizeRowPalette } from './customize-row';
import {
  BOUNDARY_HEIGHT,
  EMPTY_GROUP_HEIGHT,
  GROUP_RADIUS,
  LIST_SIDE_PADDING,
  ROW_HEIGHT,
  SECTION_LABEL_HEIGHT,
  SECTION_TOP_GAP,
  indexForOffset,
  offsetForIndex,
} from './customize-layout';
import { AUTO_SCROLL_EDGE, AUTO_SCROLL_SPEED, ROW_MORPH, ROW_SPRING } from './customize-motion';

const reorderHaptic = (): void => {
  void haptics.selection();
};

/** The "Visible" label sits above the rows, so list coords trail content coords by this. */
const LIST_TOP_IN_CONTENT = SECTION_LABEL_HEIGHT;

export type CustomizeListPalette = CustomizeRowPalette & {
  sectionLabel: string;
  emptyGroupBackground: string;
  emptyGroupLabel: string;
};

export type CustomizeListProps = {
  /** Live drag order. The drawer owns it so Save can read it without a render. */
  order: SharedValue<string[]>;
  palette: CustomizeListPalette;
};

/**
 * The Visible / Hidden arrangement, as one absolutely-positioned stack.
 *
 * Rows are placed by transform rather than by flow, so reordering never
 * triggers layout and the whole drag stays on the UI thread. The section label
 * and the empty-group placeholder read the same shared order, which is what
 * keeps them in step with the rows mid-drag.
 */
export function CustomizeList({ order, palette }: CustomizeListProps): ReactElement {
  const activeId = useSharedValue<string | null>(null);
  const dragStart = useSharedValue(0);
  const dragTranslation = useSharedValue(0);
  const scrollAdjust = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  /**
   * Where the lifted row's top edge is, in list coordinates: the slot it left,
   * plus how far the finger has travelled, plus however far the list has crept
   * underneath it.
   */
  const activeOffset = useDerivedValue(
    () => dragStart.get() + dragTranslation.get() + scrollAdjust.get(),
  );

  /**
   * The one place rows change places. Driven by the lifted row's position
   * rather than by the gesture, so a drag and an auto-scroll settle slots
   * through exactly the same path.
   */
  useAnimatedReaction(
    () => ({ id: activeId.get(), offset: activeOffset.get() }),
    ({ id, offset }) => {
      if (id === null) return;
      const list = order.get();
      const from = list.indexOf(id);
      const target = indexForOffset(list, offset);
      if (target === from) return;

      // Identity means the rule refused the move: Visible is at its floor with
      // nothing left to promote in the dragged row's place.
      const next = moveInDragOrder(list, id, target);
      if (next === list) return;
      order.set(next);
      scheduleOnRN(reorderHaptic);
    },
  );

  const scrollHandler = useAnimatedScrollHandler(event => {
    scrollOffset.set(event.contentOffset.y);
  });

  /**
   * Creeps the list while a drag is held against either edge, so a row can
   * reach a slot that started off screen. The same delta is added to
   * `scrollAdjust`, which keeps the row under the finger while the content
   * moves beneath it.
   *
   * Runs on every frame the sheet is open rather than being armed around
   * each drag. `setActive` is a JS-thread function, and the reaction that
   * would toggle it runs on the UI runtime — calling it from there is a
   * synchronous call into a remote function, which crashes the app.
   * Guarding on `activeId` costs one shared-value read per frame instead.
   */
  useFrameCallback(() => {
    if (activeId.get() === null) return;

    const viewport = viewportHeight.get();
    if (viewport <= 0) return;

    const top = activeOffset.get() + LIST_TOP_IN_CONTENT - scrollOffset.get();
    const delta =
      top < AUTO_SCROLL_EDGE
        ? -AUTO_SCROLL_SPEED
        : top + ROW_HEIGHT > viewport - AUTO_SCROLL_EDGE
          ? AUTO_SCROLL_SPEED
          : 0;
    if (delta === 0) return;

    const maxScroll = Math.max(0, contentHeightOf(order.get()) + LIST_TOP_IN_CONTENT - viewport);
    const next = Math.min(Math.max(scrollOffset.get() + delta, 0), maxScroll);
    if (next === scrollOffset.get()) return;

    scrollAdjust.set(scrollAdjust.get() + (next - scrollOffset.get()));
    scrollOffset.set(next);
    scrollTo(scrollRef, 0, next, false);
  });

  const stackStyle = useAnimatedStyle(() => ({
    height: withTiming(contentHeightOf(order.get()), ROW_MORPH),
  }));

  /** Rides the boundary's slot, so it slides as rows cross it. */
  const hiddenLabelStyle = useAnimatedStyle(() => {
    const list = order.get();
    return {
      transform: [
        { translateY: withSpring(offsetForIndex(list, list.indexOf(BOUNDARY_ID)), ROW_SPRING) },
      ],
    };
  });

  const emptyGroupStyle = useAnimatedStyle(() => {
    const list = order.get();
    const isEmpty = list.indexOf(BOUNDARY_ID) === list.length - 1;
    return {
      opacity: withTiming(isEmpty ? 1 : 0, ROW_MORPH),
      transform: [{ translateY: withSpring(offsetForIndex(list, list.length), ROW_SPRING) }],
    };
  });

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      onLayout={event => {
        viewportHeight.set(event.nativeEvent.layout.height);
      }}
    >
      <Text style={[styles.sectionLabel, { color: palette.sectionLabel }]}>Visible</Text>

      <Animated.View style={stackStyle}>
        <Animated.View style={[styles.hiddenLabelSlot, hiddenLabelStyle]}>
          <Text style={[styles.hiddenLabel, { color: palette.sectionLabel }]}>Hidden</Text>
        </Animated.View>

        <Animated.View
          pointerEvents='none'
          style={[
            styles.emptyGroup,
            { backgroundColor: palette.emptyGroupBackground },
            emptyGroupStyle,
          ]}
        >
          <Text style={[styles.emptyGroupLabel, { color: palette.emptyGroupLabel }]}>
            No hidden items
          </Text>
        </Animated.View>

        {TAB_CATALOG.map(entry => (
          <CustomizeRow
            key={entry.id}
            entry={entry}
            order={order}
            activeId={activeId}
            activeOffset={activeOffset}
            dragStart={dragStart}
            dragTranslation={dragTranslation}
            scrollAdjust={scrollAdjust}
            palette={palette}
          />
        ))}
      </Animated.View>
    </Animated.ScrollView>
  );
}

function contentHeightOf(list: readonly string[]): number {
  'worklet';
  const boundary = list.indexOf(BOUNDARY_ID);
  const hasHidden = boundary !== -1 && boundary < list.length - 1;
  return offsetForIndex(list, list.length) + (hasHidden ? 0 : EMPTY_GROUP_HEIGHT);
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    paddingHorizontal: LIST_SIDE_PADDING + 4,
    height: SECTION_LABEL_HEIGHT,
    lineHeight: SECTION_LABEL_HEIGHT,
  },
  hiddenLabelSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BOUNDARY_HEIGHT,
    justifyContent: 'flex-end',
  },
  hiddenLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    paddingHorizontal: LIST_SIDE_PADDING + 4,
    height: SECTION_LABEL_HEIGHT,
    lineHeight: SECTION_LABEL_HEIGHT,
    marginTop: SECTION_TOP_GAP,
  },
  emptyGroup: {
    position: 'absolute',
    left: LIST_SIDE_PADDING,
    right: LIST_SIDE_PADDING,
    height: EMPTY_GROUP_HEIGHT,
    borderRadius: GROUP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyGroupLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
});
