import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  ICON_SIZE,
  SEARCH_BUTTON_SIZE,
  TAB_BAR_HORIZONTAL_PADDING,
  TAB_BAR_SHADOW,
} from '@/src/features/bottom-navigation/constants';
import { useSpacesTabBarHeight } from '@/src/features/bottom-navigation';
import { useCSSVariable } from 'uniwind';
import { haptics } from '@/src/utils/haptics';

import {
  FAB_ACTIONS_GAP,
  FAB_ACTION_SPACING,
  FAB_GAP,
  FAB_SLIDE_X,
  FAB_SPRING,
} from '../constants';
import type { QuickAction, QuickActionId } from '../model/actions';

type ActionRowProps = {
  isOpen: SharedValue<boolean>;
  /** Row position, top-down. Decides how far it folds. */
  index: number;
  numberOfRows: number;
  containerHeight: SharedValue<number>;
  children: ReactElement;
};

/**
 * One row's entrance.
 *
 * Two axes. The vertical one is the stagger: a row's closed position is
 * `containerHeight - index * (containerHeight / rows)`, so the top row travels
 * the full height and the bottom row barely moves, and the stack folds down
 * into the button instead of sliding as a block. The horizontal one is a
 * 20pt nudge that keeps the entrance from looking purely vertical.
 */
function ActionRow({
  isOpen,
  index,
  numberOfRows,
  containerHeight,
  children,
}: ActionRowProps): ReactElement {
  const rowStyle = useAnimatedStyle(() => {
    const open = isOpen.get();
    const height = containerHeight.get();

    return {
      transform: [
        { translateX: withSpring(open ? 0 : FAB_SLIDE_X, FAB_SPRING) },
        {
          translateY: withSpring(open ? 0 : height - index * (height / numberOfRows), FAB_SPRING),
        },
      ],
    };
  });

  return <Animated.View style={[rowStyle, styles.row]}>{children}</Animated.View>;
}

type PillProps = {
  label: string;
  icon: ReactElement;
  onPress: () => void;
};

function ActionPill({ label, icon, onPress }: PillProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      className='flex-row items-center gap-3 rounded-full bg-spaces-background px-5 py-3.5'
      style={styles.pill}
    >
      {icon}
      <Text className='text-[17px] font-medium text-spaces-foreground'>{label}</Text>
    </Pressable>
  );
}

export type FabActionsProps = {
  isOpen: SharedValue<boolean>;
  /** What this screen offers, already in display order. */
  actions: readonly QuickAction[];
  onSelect: (id: QuickActionId) => void;
};

/**
 * The stack of pills, right-aligned on the button's column.
 *
 * Sits exactly one button-height plus a gap above the button, and shares its
 * right inset, so the pills and the button line up on one edge however the
 * bar is sized.
 */
export function FabActions({ isOpen, actions, onSelect }: FabActionsProps): ReactElement {
  const barHeight = useSpacesTabBarHeight();
  const iconColor = useCSSVariable('--color-spaces-foreground') as string;

  // Measured, not assumed: the rows' fold distances are fractions of it.
  const containerHeight = useSharedValue(0);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isOpen.get() ? 1 : 0),
    pointerEvents: isOpen.get() ? 'box-none' : 'none',
  }));

  return (
    <Animated.View
      onLayout={event => containerHeight.set(event.nativeEvent.layout.height)}
      style={[
        containerStyle,
        {
          position: 'absolute',
          right: TAB_BAR_HORIZONTAL_PADDING,
          bottom: barHeight + FAB_GAP + SEARCH_BUTTON_SIZE + FAB_ACTIONS_GAP,
          alignItems: 'flex-end',
          gap: FAB_ACTION_SPACING,
        },
      ]}
    >
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <ActionRow
            key={action.id}
            index={index}
            numberOfRows={actions.length}
            containerHeight={containerHeight}
            isOpen={isOpen}
          >
            <ActionPill
              label={action.label}
              icon={<Icon size={ICON_SIZE - 4} color={iconColor} strokeWidth={1.8} />}
              onPress={() => {
                void haptics.buttonTap();
                isOpen.set(false);
                onSelect(action.id);
              }}
            />
          </ActionRow>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Transforms grow from the edge the pills are aligned to, so a row that is
  // still folded does not drift sideways as it arrives.
  row: { transformOrigin: 'right' },
  pill: { boxShadow: TAB_BAR_SHADOW },
});
