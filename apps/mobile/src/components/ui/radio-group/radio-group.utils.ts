import { useCombinedAnimationDisabledState } from '@/src/hooks/usePopupRootAnimation';
import type { AnimationRootDisableAll } from '@/src/types/animation';

// --------------------------------------------------

/**
 * Animation hook for RadioGroup root component.
 * Handles cascading animation disabled state to child components.
 */
export function useRadioGroupRootAnimation(options: {
  animation: AnimationRootDisableAll | undefined;
}) {
  const { animation } = options;

  const isAllAnimationsDisabled = useCombinedAnimationDisabledState(animation);

  return {
    isAllAnimationsDisabled,
  };
}

/**
 * Display names for RadioGroup components
 */
export const DISPLAY_NAME = {
  RADIO_GROUP_ROOT: 'Lotus.Primitive.RadioGroup.Root',
  RADIO_GROUP_ITEM: 'Lotus.Primitive.RadioGroup.Item',
} as const;
