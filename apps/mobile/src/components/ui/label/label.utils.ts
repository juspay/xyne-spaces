import { useCombinedAnimationDisabledState } from '@/src/hooks/usePopupRootAnimation';
import type { AnimationRootDisableAll } from '@/src/types/animation';

/**
 * Animation hook for Label root component
 * Handles root-level animation configuration and provides context for child components
 */
export function useLabelRootAnimation(options: { animation: AnimationRootDisableAll | undefined }) {
  const { animation } = options;

  const isAllAnimationsDisabled = useCombinedAnimationDisabledState(animation);

  return {
    isAllAnimationsDisabled,
  };
}

/**
 * Display names for Label components
 */
export const DISPLAY_NAME = {
  LABEL_ROOT: 'Lotus.Label.Root',
  LABEL_TEXT: 'Lotus.Label.Text',
} as const;
