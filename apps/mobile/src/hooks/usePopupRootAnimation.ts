import { useSharedValue } from 'react-native-reanimated';
import type { AnimationRoot } from '@/src/types/animation';
import { useAnimationSettings } from '../contexts/animation-settings-context';
import { getRootAnimationState } from '../utils/animation';

/**
 * Resolves whether all animations are disabled, combining:
 * 1. Parent cascade from AnimationSettingsContext (set by a parent Root component)
 * 2. Own animation prop on this component instance
 */
export const useCombinedAnimationDisabledState = <TConfig extends Record<string, unknown>>(
  animation: AnimationRoot<TConfig> | undefined,
): boolean => {
  const parentContext = useAnimationSettings();
  const parentIsAllAnimationsDisabled = parentContext?.isAllAnimationsDisabled ?? false;

  const { isAllAnimationsDisabled: ownIsAllAnimationsDisabled } = getRootAnimationState(animation);

  return parentIsAllAnimationsDisabled || ownIsAllAnimationsDisabled;
};

/**
 * Root animation hook for popup-like components (BottomSheet, Popover, etc.)
 * Creates shared animation values and resolves the cascaded disabled state.
 */
export const usePopupRootAnimation = (options: { animation?: AnimationRoot }) => {
  const isAllAnimationsDisabled = useCombinedAnimationDisabledState(options.animation);

  const progress = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const isGestureReleaseAnimationRunning = useSharedValue(false);

  return {
    isAllAnimationsDisabled,
    progress,
    isDragging,
    isGestureReleaseAnimationRunning,
  };
};
