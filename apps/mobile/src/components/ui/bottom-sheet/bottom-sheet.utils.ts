import { useAnimationSettings } from '@/src/contexts/animation-settings-context';
import { AnimationDisabled } from '@/src/types/animation';
import { createContext } from '@/src/contexts/create-context';
import { getAnimationState, getIsAnimationDisabledValue } from '@/src/utils/animation';
import type { BottomSheetAnimationContextValue } from './bottom-sheet.types';

const [BottomSheetAnimationProvider, useBottomSheetAnimation] =
  createContext<BottomSheetAnimationContextValue>({
    name: 'BottomSheetAnimationContext',
  });

export { BottomSheetAnimationProvider, useBottomSheetAnimation };

// --------------------------------------------------

/**
 * Animation hook for BottomSheet Content component
 * Handles animation disabled state based on local and global animation settings
 */
export function useBottomSheetContentAnimation(options: {
  /** Animation configuration for bottom sheet content */
  animation: AnimationDisabled | undefined;
}) {
  const { animation } = options;

  // Read from global animation context (always available in compound parts)
  const { isAllAnimationsDisabled } = useAnimationSettings();

  const { isAnimationDisabled } = getAnimationState(animation);

  const isAnimationDisabledValue = getIsAnimationDisabledValue({
    isAnimationDisabled,
    isAllAnimationsDisabled,
  });

  return {
    isAnimationDisabledValue,
  };
}

/**
 * Display names for BottomSheet components
 */
export const DISPLAY_NAME = {
  ROOT: 'Lotus.BottomSheet.Root',
  TRIGGER: 'Lotus.BottomSheet.Trigger',
  PORTAL: 'Lotus.BottomSheet.Portal',
  OVERLAY: 'Lotus.BottomSheet.Overlay',
  CONTENT: 'Lotus.BottomSheet.Content',
  CLOSE: 'Lotus.BottomSheet.Close',
  TITLE: 'Lotus.BottomSheet.Title',
  DESCRIPTION: 'Lotus.BottomSheet.Description',
};
