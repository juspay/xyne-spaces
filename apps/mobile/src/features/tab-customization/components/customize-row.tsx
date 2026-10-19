import { memo, useMemo, type ReactElement } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { DragIcon } from '@/src/features/bottom-navigation/icons';
import { haptics } from '@/src/utils/haptics';
import { NAV_ICON_STROKE_WIDTH } from '@/src/features/bottom-navigation/constants';
import type { TabEntry } from '@/src/features/bottom-navigation/model/catalog';
import { BOUNDARY_ID } from '@/src/features/bottom-navigation/model/layout';
import {
  GROUP_RADIUS,
  LIFTED_RADIUS,
  LIST_SIDE_PADDING,
  ROW_HEIGHT,
  offsetForIndex,
} from './customize-layout';
import { DRAG_ACTIVATION_MS, ROW_MORPH, ROW_SPRING } from './customize-motion';

// Module scope, so the worklet captures a plain function rather than having to
// carry the haptics facade across the bridge.
const liftHaptic = (): void => {
  void haptics.longPress();
};

export type CustomizeRowPalette = {
  groupBackground: string;
  liftedBackground: string;
  separator: string;
  label: string;
  icon: string;
  handle: string;
};

export type CustomizeRowProps = {
  entry: TabEntry;
  /** Live drag order, including the boundary marker. Drives every row's slot. */
  order: SharedValue<string[]>;
  activeId: SharedValue<string | null>;
  /** Top edge of the lifted row, in list coordinates. Owned by the list. */
  activeOffset: SharedValue<number>;
  /** Slot the lift started from; the list adds the finger travel to it. */
  dragStart: SharedValue<number>;
  dragTranslation: SharedValue<number>;
  scrollAdjust: SharedValue<number>;
  palette: CustomizeRowPalette;
};

/**
 * One draggable destination.
 *
 * Everything that changes during a drag — slot, shape, fill, elevation — is
 * derived on the UI thread from the shared order, so dragging never touches
 * React. The list commits to state once, on release.
 */
export const CustomizeRow = memo(function CustomizeRow({
  entry,
  order,
  activeId,
  activeOffset,
  dragStart,
  dragTranslation,
  scrollAdjust,
  palette,
}: CustomizeRowProps): ReactElement {
  const Icon = entry.icon;
  const id = entry.id;

  /**
   * Where this row sits in its group: which corners it rounds, and whether it
   * draws a separator beneath itself. Recomputed whenever the order moves,
   * which is what re-rounds a group as rows enter and leave it.
   */
  const shape = useDerivedValue(() => {
    const list = order.get();
    const index = list.indexOf(id);
    const lifted = activeId.get() === id;
    if (index === -1) return { first: true, last: true, lifted };

    const boundary = list.indexOf(BOUNDARY_ID);
    const inVisible = index < boundary;
    return {
      first: inVisible ? index === 0 : index === boundary + 1,
      last: inVisible ? index === boundary - 1 : index === list.length - 1,
      lifted,
    };
  });

  const containerStyle = useAnimatedStyle(() => {
    const list = order.get();

    // The lifted row is already under the finger: following it must not be
    // animated, or the row lags behind the touch.
    if (activeId.get() === id) {
      return {
        transform: [{ translateY: activeOffset.get() }, { scale: withTiming(1.03, ROW_MORPH) }],
        zIndex: 2,
      };
    }

    return {
      transform: [
        { translateY: withSpring(offsetForIndex(list, list.indexOf(id)), ROW_SPRING) },
        { scale: withTiming(1, ROW_MORPH) },
      ],
      zIndex: 1,
    };
  });

  const surfaceStyle = useAnimatedStyle(() => {
    const { first, last, lifted } = shape.get();
    const top = lifted ? LIFTED_RADIUS : first ? GROUP_RADIUS : 0;
    const bottom = lifted ? LIFTED_RADIUS : last ? GROUP_RADIUS : 0;

    return {
      backgroundColor: withTiming(
        lifted ? palette.liftedBackground : palette.groupBackground,
        ROW_MORPH,
      ),
      borderTopLeftRadius: withTiming(top, ROW_MORPH),
      borderTopRightRadius: withTiming(top, ROW_MORPH),
      borderBottomLeftRadius: withTiming(bottom, ROW_MORPH),
      borderBottomRightRadius: withTiming(bottom, ROW_MORPH),
    };
  });

  const separatorStyle = useAnimatedStyle(() => {
    const { last, lifted } = shape.get();
    return { opacity: withTiming(last || lifted ? 0 : 1, ROW_MORPH) };
  });

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // Holding is what arms the drag, so a flick still scrolls the list.
        .activateAfterLongPress(DRAG_ACTIVATION_MS)
        .onStart(() => {
          const list = order.get();
          // Captured once. Recomputing the slot each frame would feed the row's
          // own reordering back into its position and make it judder.
          dragStart.set(offsetForIndex(list, list.indexOf(id)));
          dragTranslation.set(0);
          scrollAdjust.set(0);
          activeId.set(id);
          scheduleOnRN(liftHaptic);
        })
        .onUpdate(event => {
          if (activeId.get() !== id) return;
          dragTranslation.set(event.translationY);
        })
        // Runs however the touch ends, so a cancelled drag can never strand a
        // row outside the list.
        .onFinalize(() => {
          if (activeId.get() !== id) return;
          activeId.set(null);
        }),
    [activeId, dragStart, dragTranslation, id, order, scrollAdjust],
  );

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.surface, surfaceStyle]}>
          <Icon size={20} color={palette.icon} strokeWidth={NAV_ICON_STROKE_WIDTH} />
          <Text numberOfLines={1} style={[styles.label, { color: palette.label }]}>
            {entry.label}
          </Text>
          <DragIcon width={18} height={18} color={palette.handle} />
          <Animated.View
            pointerEvents='none'
            style={[styles.separator, { backgroundColor: palette.separator }, separatorStyle]}
          />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: LIST_SIDE_PADDING,
    right: LIST_SIDE_PADDING,
    height: ROW_HEIGHT,
  },
  surface: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  separator: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
