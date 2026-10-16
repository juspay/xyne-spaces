import { Easing } from 'react-native-reanimated';
import { useEffect } from 'react';
import type { ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';
import { useAnimationSettings } from '@/src/contexts/animation-settings-context';
import { createContext } from '@/src/contexts/create-context';
import { useCombinedAnimationDisabledState } from '@/src/hooks/usePopupRootAnimation';
import { useResolvedStyleProperty } from '@/src/hooks/useResolvedStyleProperty';
import {
  getAnimationState,
  getAnimationValueMergedConfig,
  getAnimationValueProperty,
  getIsAnimationDisabledValue,
  getRootAnimationState,
} from '@/src/utils/animation';

import type {
  SwitchAnimationContextValue,
  SwitchRootAnimation,
  SwitchThumbAnimation,
} from './switch.types';

export const DISPLAY_NAME = {
  SWITCH_ROOT: 'Lotus.Switch.Root',
  SWITCH_THUMB: 'Lotus.Switch.Thumb',
  SWITCH_START_CONTENT: 'Lotus.Switch.StartContent',
  SWITCH_END_CONTENT: 'Lotus.Switch.EndContent',
} as const;
export const ANIMATION_DURATION = 175;
export const ANIMATION_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
export const DEFAULT_TIMING_CONFIG = {
  duration: ANIMATION_DURATION,
  easing: ANIMATION_EASING,
};
export const DEFAULT_SPRING_CONFIG = {
  damping: 120,
  stiffness: 1600,
  mass: 2,
};
export const DEFAULT_THUMB_WIDTH = 28;
export const DEFAULT_THUMB_LEFT = 2;

const [SwitchAnimationProvider, useSwitchAnimation] = createContext<SwitchAnimationContextValue>({
  name: 'SwitchAnimationContext',
});

export { SwitchAnimationProvider, useSwitchAnimation };

// --------------------------------------------------

/** Props → SharedValues so UI-thread styles track selection reliably (Reanimated 4). */
function useAnimatedSwitchSelection(isSelected: boolean | undefined) {
  const isSelectedSV = useSharedValue(isSelected ?? false);
  useEffect(() => {
    isSelectedSV.value = isSelected ?? false;
  }, [isSelected, isSelectedSV]);
  return isSelectedSV;
}

function useAnimatedSwitchAnimationDisabled(isAnimationDisabled: boolean) {
  const isDisabledSV = useSharedValue(isAnimationDisabled);
  useEffect(() => {
    isDisabledSV.value = isAnimationDisabled;
  }, [isAnimationDisabled, isDisabledSV]);
  return isDisabledSV;
}

/** Push theme / config colors into shared values so worklets don’t keep stale strings after theme toggles. */
function useSyncedColorPair(pair: readonly [string, string]) {
  const c0 = useSharedValue(pair[0]);
  const c1 = useSharedValue(pair[1]);
  useEffect(() => {
    c0.value = pair[0];
    c1.value = pair[1];
  }, [pair[0], pair[1], c0, c1]);
  return [c0, c1] as const;
}

// --------------------------------------------------

export function useSwitchRootAnimation(options: {
  animation: SwitchRootAnimation | undefined;
  isSelected: boolean | undefined;
}) {
  const { animation, isSelected } = options;

  const themeColorOff = useCSSVariable('--color-accent');
  const themeColorOn = useCSSVariable('--color-brand');

  const isSelectedSV = useAnimatedSwitchSelection(isSelected);
  const isSwitchPressed = useSharedValue(false);
  const contentContainerWidth = useSharedValue(0);

  const { animationConfig, isAnimationDisabled } = getRootAnimationState(animation);
  const isAllAnimationsDisabled = useCombinedAnimationDisabledState(animation);

  const isAnimationDisabledValue = getIsAnimationDisabledValue({
    isAnimationDisabled,
    isAllAnimationsDisabled,
  });
  const isAnimationDisabledSV = useAnimatedSwitchAnimationDisabled(isAnimationDisabledValue);

  const scaleValue = getAnimationValueProperty({
    animationValue: animationConfig?.scale,
    property: 'value',
    defaultValue: [1, 0.96] as [number, number],
  });

  const scaleTimingConfig = getAnimationValueMergedConfig({
    animationValue: animationConfig?.scale,
    property: 'timingConfig',
    defaultValue: { duration: 150 },
  });

  const backgroundColorValue = getAnimationValueProperty({
    animationValue: animationConfig?.backgroundColor,
    property: 'value',
    defaultValue: [themeColorOff, themeColorOn] as [string, string],
  });

  const [rootBgOff, rootBgOn] = useSyncedColorPair(backgroundColorValue);

  const backgroundColorTimingConfig = getAnimationValueMergedConfig({
    animationValue: animationConfig?.backgroundColor,
    property: 'timingConfig',
    defaultValue: DEFAULT_TIMING_CONFIG,
  });

  const rContainerStyle = useAnimatedStyle(() => {
    if (isAnimationDisabledSV.value) {
      return {
        backgroundColor: isSelectedSV.value ? rootBgOn.value : rootBgOff.value,
      };
    }

    const pressed = isSwitchPressed.get();

    return {
      backgroundColor: withTiming(
        isSelectedSV.value ? rootBgOn.value : rootBgOff.value,
        backgroundColorTimingConfig,
      ),
      transform: [
        {
          scale: withTiming(pressed ? scaleValue[1] : scaleValue[0], scaleTimingConfig),
        },
      ],
    };
  });

  return {
    rContainerStyle,
    isSwitchPressed,
    contentContainerWidth,
    isAllAnimationsDisabled,
  };
}

// --------------------------------------------------

export function useSwitchThumbAnimation(options: {
  animation: SwitchThumbAnimation | undefined;
  style: ViewStyle | undefined;
  className: string;
  isSelected: boolean | undefined;
}) {
  const { animation, style, className, isSelected } = options;

  const isSelectedSV = useAnimatedSwitchSelection(isSelected);
  const themeColorAccentForeground = useCSSVariable('--color-accent-foreground');
  const thumbOnColor =
    typeof themeColorAccentForeground === 'string' && themeColorAccentForeground.length > 0
      ? themeColorAccentForeground
      : '#ffffff';

  const [width, left] = useResolvedStyleProperty({
    className,
    style,
    propertyNames: ['width', 'left'] as const,
  });

  const computedWidth = typeof width === 'number' ? width : DEFAULT_THUMB_WIDTH;
  const computedLeft = typeof left === 'number' ? left : DEFAULT_THUMB_LEFT;

  const { isAllAnimationsDisabled } = useAnimationSettings();
  const { contentContainerWidth } = useSwitchAnimation();

  const { animationConfig, isAnimationDisabled } = getAnimationState(animation);
  const isAnimationDisabledValue = getIsAnimationDisabledValue({
    isAnimationDisabled,
    isAllAnimationsDisabled,
  });
  const isAnimationDisabledSV = useAnimatedSwitchAnimationDisabled(isAnimationDisabledValue);

  const leftValue = getAnimationValueProperty({
    animationValue: animationConfig?.left,
    property: 'value',
    defaultValue: computedLeft,
  });

  const leftSpringConfig = getAnimationValueMergedConfig({
    animationValue: animationConfig?.left,
    property: 'springConfig',
    defaultValue: DEFAULT_SPRING_CONFIG,
  });

  const backgroundColorValue = getAnimationValueProperty({
    animationValue: animationConfig?.backgroundColor,
    property: 'value',
    defaultValue: ['#ffffff', thumbOnColor] as [string, string],
  });

  const [thumbBgOff, thumbBgOn] = useSyncedColorPair(backgroundColorValue);

  const backgroundColorTimingConfig = getAnimationValueMergedConfig({
    animationValue: animationConfig?.backgroundColor,
    property: 'timingConfig',
    defaultValue: DEFAULT_TIMING_CONFIG,
  });

  const rContainerStyle = useAnimatedStyle(() => {
    const isMounted = contentContainerWidth.get() > 0;

    if (!isMounted) {
      if (isSelectedSV.value) {
        return {
          right: leftValue,
          backgroundColor: thumbBgOn.value,
        };
      }
      return {
        left: leftValue,
        backgroundColor: thumbBgOff.value,
      };
    }

    const targetLeft = isSelectedSV.value
      ? contentContainerWidth.get() - computedWidth - leftValue
      : leftValue;

    if (isAnimationDisabledSV.value) {
      return {
        left: targetLeft,
        backgroundColor: isSelectedSV.value ? thumbBgOn.value : thumbBgOff.value,
      };
    }

    return {
      left: withSpring(targetLeft, leftSpringConfig),
      backgroundColor: withTiming(
        isSelectedSV.value ? thumbBgOn.value : thumbBgOff.value,
        backgroundColorTimingConfig,
      ),
    };
  });

  return { rContainerStyle };
}
