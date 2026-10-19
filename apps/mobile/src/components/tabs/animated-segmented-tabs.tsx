import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
  type GestureResponderEvent,
  type PressableProps,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { withAlpha } from '@/src/utils/color';
import { haptics } from '@/src/utils/haptics';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

type TabLayout = {
  x: number;
  width: number;
};

type TabsVariant = 'segmented' | 'badges';

type AnimatedSegmentedTabsContextValue = {
  activeColor: string;
  inactiveColor: string;
  itemHeight: number;
  minTriggerWidth: number;
  onValueChange: (value: string) => void;
  registerTriggerLayout: (value: string, layout: TabLayout) => void;
  triggerHorizontalPadding: number;
  value: string;
  variant: TabsVariant;
  inactiveTriggerBackground: string;
  inactiveTriggerBorder: string;
  activeTriggerBorder: string;
};

type AnimatedSegmentedTabsRootProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
  /** `segmented` = single pill track. `badges` = separate badge chips (chat filter style). */
  variant?: TabsVariant;
  height?: number;
  itemHeight?: number;
  sidePadding?: number;
  triggerHorizontalPadding?: number;
  minTriggerWidth?: number;
  gap?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerClassName?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  indicatorStyle?: StyleProp<ViewStyle>;
};

type AnimatedSegmentedTabsTriggerProps<T extends string> = Omit<
  PressableProps,
  'children' | 'onPress' | 'onLayout'
> & {
  value: T;
  children: ReactNode;
  className?: string;
  style?: PressableProps['style'];
  onPress?: PressableProps['onPress'];
  onLayout?: PressableProps['onLayout'];
};

type AnimatedSegmentedTabsLabelProps = {
  children: ReactNode;
  className?: string;
  style?: StyleProp<TextStyle>;
  activeStyle?: StyleProp<TextStyle>;
  inactiveStyle?: StyleProp<TextStyle>;
};

const INDICATOR_DURATION_MS = 260;
const TEXT_DURATION_MS = 160;
const INDICATOR_EASING = Easing.bezier(0.23, 1, 0.32, 1);

const AnimatedSegmentedTabsContext = createContext<AnimatedSegmentedTabsContextValue | null>(null);

function useAnimatedSegmentedTabsContext(componentName: string) {
  const context = useContext(AnimatedSegmentedTabsContext);

  if (!context) {
    throw new Error(`${componentName} must be used inside AnimatedSegmentedTabs.Root`);
  }

  return context;
}

function AnimatedSegmentedTabsRoot<T extends string>({
  value,
  onValueChange,
  children,
  variant = 'segmented',
  height = 46,
  itemHeight = 34,
  sidePadding = 4,
  triggerHorizontalPadding = 16,
  minTriggerWidth = 64,
  gap = 4,
  className,
  style,
  contentContainerClassName,
  contentContainerStyle,
  indicatorStyle: indicatorStyleProp,
}: AnimatedSegmentedTabsRootProps<T>) {
  const scrollRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, TabLayout>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  const isBadges = variant === 'badges';

  // The badges variant is the brand-coloured pill row, so it follows the user's
  // chat bubble colour; the segmented variant keeps its own neutral tokens.
  const { accentSoft, accentText } = useBubbleAccent();
  const tabActiveText = useCSSVariable('--color-tab-active-text') as string;
  const tabActiveBg = useCSSVariable('--color-tab-active-bg') as string;
  const activeColor = isBadges ? accentText : tabActiveText;
  const indicatorFill = isBadges ? accentSoft : tabActiveBg;
  const inputColor = useCSSVariable('--color-input') as string;
  const cardColor = useCSSVariable('--color-card') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable(
    isBadges ? '--color-tab-inactive-text' : '--color-secondary-text',
  ) as string;
  const activeBorderColor = accentText;

  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);

  const segmentedIndicatorColor = withAlpha(indicatorFill, 0.28);
  const segmentedBorderColor = withAlpha(foregroundColor, 0.07);
  const inactiveTriggerBorder = withAlpha(foregroundColor, 0.15);
  const indicatorColor = isBadges ? indicatorFill : segmentedIndicatorColor;

  const registerTriggerLayout = useCallback((id: string, layout: TabLayout) => {
    setLayouts(current => {
      const previous = current[id];

      if (
        previous &&
        Math.abs(previous.x - layout.x) < 0.5 &&
        Math.abs(previous.width - layout.width) < 0.5
      ) {
        return current;
      }

      return {
        ...current,
        [id]: layout,
      };
    });
  }, []);

  useEffect(() => {
    const activeLayout = layouts[value];

    if (!activeLayout) {
      indicatorOpacity.value = withTiming(0, { duration: 80 });
      return;
    }

    indicatorOpacity.value = withTiming(1, { duration: 80 });
    indicatorX.value = withTiming(activeLayout.x, {
      duration: INDICATOR_DURATION_MS,
      easing: INDICATOR_EASING,
    });
    indicatorWidth.value = withTiming(activeLayout.width, {
      duration: INDICATOR_DURATION_MS,
      easing: INDICATOR_EASING,
    });

    if (viewportWidth > 0 && contentWidth > viewportWidth) {
      const centeredX = activeLayout.x + activeLayout.width / 2 - viewportWidth / 2;
      const maxX = contentWidth - viewportWidth;

      scrollRef.current?.scrollTo({
        x: Math.max(0, Math.min(centeredX, maxX)),
        animated: true,
      });
    }
  }, [contentWidth, indicatorOpacity, indicatorWidth, indicatorX, layouts, value, viewportWidth]);

  const animatedIndicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    width: indicatorWidth.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  const contextValue = useMemo<AnimatedSegmentedTabsContextValue>(
    () => ({
      activeColor,
      inactiveColor: mutedColor,
      itemHeight,
      minTriggerWidth,
      onValueChange: onValueChange as (value: string) => void,
      registerTriggerLayout,
      triggerHorizontalPadding,
      value,
      variant,
      inactiveTriggerBackground: cardColor,
      inactiveTriggerBorder,
      activeTriggerBorder: activeBorderColor,
    }),
    [
      activeBorderColor,
      activeColor,
      cardColor,
      inactiveTriggerBorder,
      itemHeight,
      minTriggerWidth,
      mutedColor,
      onValueChange,
      registerTriggerLayout,
      triggerHorizontalPadding,
      value,
      variant,
    ],
  );

  const rootStyle: ViewStyle = isBadges
    ? {
        height,
        backgroundColor: 'transparent',
        overflow: 'visible',
      }
    : {
        height,
        borderRadius: height / 2,
        backgroundColor: inputColor,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: segmentedBorderColor,
        overflow: 'hidden',
      };

  return (
    <AnimatedSegmentedTabsContext.Provider value={contextValue}>
      <View {...(className !== undefined ? { className } : {})} style={[rootStyle, style]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onLayout={event => {
            setViewportWidth(event.nativeEvent.layout.width);
          }}
          onContentSizeChange={width => {
            setContentWidth(width);
          }}
          {...(contentContainerClassName !== undefined ? { contentContainerClassName } : {})}
          contentContainerStyle={[{ flexGrow: isBadges ? 0 : 1 }, contentContainerStyle]}
        >
          <View
            style={{
              minWidth: isBadges ? undefined : viewportWidth,
              height,
              flexDirection: 'row',
              alignItems: 'center',
              gap,
              paddingHorizontal: sidePadding,
            }}
          >
            <Animated.View
              pointerEvents='none'
              style={[
                {
                  position: 'absolute',
                  left: 0,
                  top: (height - itemHeight) / 2,
                  height: itemHeight,
                  borderRadius: itemHeight / 2,
                  backgroundColor: indicatorColor,
                },
                indicatorStyleProp,
                animatedIndicatorStyle,
              ]}
            />

            {children}
          </View>
        </ScrollView>
      </View>
    </AnimatedSegmentedTabsContext.Provider>
  );
}

function AnimatedSegmentedTabsTrigger<T extends string>({
  value,
  children,
  className,
  disabled,
  onLayout,
  onPress,
  style,
  ...pressableProps
}: AnimatedSegmentedTabsTriggerProps<T>) {
  const {
    itemHeight,
    minTriggerWidth,
    onValueChange,
    registerTriggerLayout,
    triggerHorizontalPadding,
    value: activeValue,
    variant,
    inactiveTriggerBackground,
    inactiveTriggerBorder,
    activeTriggerBorder,
  } = useAnimatedSegmentedTabsContext('AnimatedSegmentedTabs.Trigger');
  const selected = activeValue === value;
  const isDisabled = !!disabled;
  const isBadges = variant === 'badges';

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;

      registerTriggerLayout(value, { x, width });
      onLayout?.(event);
    },
    [onLayout, registerTriggerLayout, value],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      onPress?.(event);

      if (!isDisabled) {
        // Re-tapping the active segment changes nothing, so it stays silent.
        if (!selected) void haptics.selection();
        onValueChange(value);
      }
    },
    [isDisabled, onPress, onValueChange, selected, value],
  );

  return (
    <Pressable
      {...pressableProps}
      accessibilityRole='tab'
      accessibilityState={{ disabled: isDisabled, selected }}
      {...(className !== undefined ? { className } : {})}
      disabled={isDisabled}
      hitSlop={pressableProps.hitSlop ?? 4}
      onLayout={handleLayout}
      onPress={handlePress}
      style={state => [
        {
          height: itemHeight,
          minWidth: minTriggerWidth,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: itemHeight / 2,
          paddingHorizontal: triggerHorizontalPadding,
          opacity: state.pressed ? 0.72 : 1,
          ...(isBadges
            ? {
                // Transparent when active so the sliding green indicator shows through.
                backgroundColor: selected ? 'transparent' : inactiveTriggerBackground,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: selected ? activeTriggerBorder : inactiveTriggerBorder,
              }
            : null),
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {children}
    </Pressable>
  );
}

function AnimatedSegmentedTabsLabel({
  children,
  className,
  style,
  activeStyle,
  inactiveStyle,
}: AnimatedSegmentedTabsLabelProps) {
  const { activeColor, inactiveColor, value, variant } = useAnimatedSegmentedTabsContext(
    'AnimatedSegmentedTabs.Label',
  );
  const selected = value === useTriggerValue();
  const progress = useSharedValue(selected ? 1 : 0);
  const isBadges = variant === 'badges';

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, {
      duration: TEXT_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [progress, selected]);

  const animatedTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [inactiveColor, activeColor]),
  }));

  return (
    <Animated.Text
      {...(className !== undefined ? { className } : {})}
      numberOfLines={1}
      style={[
        {
          fontSize: isBadges ? 16 : 15,
          lineHeight: isBadges ? 22 : 20,
          fontWeight: selected && isBadges ? '700' : '600',
        },
        selected ? activeStyle : inactiveStyle,
        style,
        animatedTextStyle,
      ]}
    >
      {children}
    </Animated.Text>
  );
}

const TriggerValueContext = createContext<string | null>(null);

function useTriggerValue() {
  const triggerValue = useContext(TriggerValueContext);

  if (!triggerValue) {
    throw new Error(
      'AnimatedSegmentedTabs.Label must be used inside AnimatedSegmentedTabs.Trigger',
    );
  }

  return triggerValue;
}

function AnimatedSegmentedTabsTriggerWithValue<T extends string>(
  props: AnimatedSegmentedTabsTriggerProps<T>,
) {
  return (
    <TriggerValueContext.Provider value={props.value}>
      <AnimatedSegmentedTabsTrigger {...props} />
    </TriggerValueContext.Provider>
  );
}

export const AnimatedSegmentedTabs = {
  Root: AnimatedSegmentedTabsRoot,
  Trigger: AnimatedSegmentedTabsTriggerWithValue,
  Label: AnimatedSegmentedTabsLabel,
};
