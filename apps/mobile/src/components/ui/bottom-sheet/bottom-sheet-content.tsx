import BottomSheet from '@gorhom/bottom-sheet';
import { forwardRef, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { ReduceMotion } from 'react-native-reanimated';
import { withUniwind } from 'uniwind';

import { useBottomSheetContentAnimation } from './bottom-sheet.utils';
import { bottomSheetClassNames } from './bottom-sheet.styles';

import { BottomSheetIsDraggingProvider } from '@/src/contexts/bottom-sheet-is-dragging-context';
import { useBottomSheetGestureHandlers } from '@/src/hooks/useBottomSheetGestureHandlers';
import { usePopupBottomSheetContentAnimation } from '@/src/hooks/usePopupBottomSheetContentAnimation';
import { BaseBottomSheetContentProps } from '@/src/types/bottom-sheet';
import { BottomSheetContentContainer } from './bottom-sheet-content-container';

const StyledBottomSheet = withUniwind(BottomSheet);

/**
 * Props for the reusable BottomSheetContent component
 */
export interface BottomSheetContentProps
  extends BaseBottomSheetContentProps, Partial<React.ComponentProps<typeof BottomSheet>> {
  /**
   * Whether the bottom sheet is open
   */
  isOpen: boolean;
  /**
   * Animation progress shared value (0=idle, 1=open, 2=close)
   */
  progress: SharedValue<number>;
  /**
   * Whether the bottom sheet is dragging
   */
  isDragging: SharedValue<boolean>;
  /**
   * Callback when the bottom sheet open state changes
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Initial index of the bottom sheet
   */
  index?: number;
  /**
   * Additional style for the background
   */
  backgroundStyle?: StyleProp<ViewStyle>;
}

/**
 * Reusable BottomSheetContent component
 *
 * This component provides a reusable bottom sheet content wrapper used across
 * Popover, Select, and other components when using bottom-sheet presentation.
 * It handles animation coordination, styling, and gesture handling.
 *
 * @example
 * ```tsx
 * <BottomSheetContent
 *   isOpen={isOpen}
 *   progress={progress}
 *   isDragging={isDragging}
 *   onOpenChange={onOpenChange}
 *   index={0}
 * >
 *   {children}
 * </BottomSheetContent>
 * ```
 */
export const BottomSheetContent = forwardRef<BottomSheet, BottomSheetContentProps>(
  (
    {
      children,
      index: initialIndex,
      backgroundClassName,
      handleIndicatorClassName,
      contentContainerClassName: contentContainerClassNameProp,
      contentContainerProps,
      animation,
      animationConfigs,
      backgroundStyle,
      isOpen,
      progress,
      isDragging,
      enableOverDrag: enableOverDragProp,
      enableDynamicSizing: enableDynamicSizingProp,
      snapPoints,
      onOpenChange,
      ...restProps
    },
    ref,
  ) => {
    const { isAnimationDisabledValue } = useBottomSheetContentAnimation({
      animation,
    });

    const { animatedIndex, isClosingOnSwipe, isPanActivated } = usePopupBottomSheetContentAnimation(
      {
        progress,
        isDragging,
      },
    );

    const contentBackgroundClassName = bottomSheetClassNames.contentBackground({
      className: backgroundClassName,
    });

    const contentHandleIndicatorClassName = bottomSheetClassNames.contentHandleIndicator({
      className: handleIndicatorClassName,
    });

    const contentContainerClassName = bottomSheetClassNames.contentContainer({
      className:
        `${contentContainerClassNameProp ?? ''} ${snapPoints !== undefined ? 'h-full' : ''}`.trim(),
    });

    const mergedAnimationConfigs = useMemo(() => {
      const reduceMotionValue = isAnimationDisabledValue
        ? ReduceMotion.Always
        : animationConfigs?.reduceMotion;
      return {
        ...animationConfigs,
        ...(reduceMotionValue !== undefined && { reduceMotion: reduceMotionValue }),
      };
    }, [animationConfigs, isAnimationDisabledValue]);

    const enableOverDrag = enableOverDragProp ?? (snapPoints === undefined ? undefined : false);
    const enableDynamicSizing = enableDynamicSizingProp ?? snapPoints === undefined;
    const maxSnapPointIndex =
      Array.isArray(snapPoints) && snapPoints.length > 0 ? snapPoints.length - 1 : undefined;
    const safeInitialIndex =
      maxSnapPointIndex !== undefined
        ? Math.min(Math.max(initialIndex ?? 0, 0), maxSnapPointIndex)
        : (initialIndex ?? 0);

    return (
      <BottomSheetIsDraggingProvider value={{ isDragging }}>
        <StyledBottomSheet
          ref={ref}
          index={-1}
          backgroundClassName={contentBackgroundClassName}
          backgroundStyle={backgroundStyle}
          handleIndicatorClassName={contentHandleIndicatorClassName}
          {...(snapPoints !== undefined ? { snapPoints } : {})}
          {...(enableOverDrag !== undefined ? { enableOverDrag } : {})}
          enableDynamicSizing={enableDynamicSizing}
          enablePanDownToClose={restProps.enablePanDownToClose ?? true}
          animatedIndex={animatedIndex ?? restProps.animatedIndex}
          animationConfigs={mergedAnimationConfigs}
          gestureEventsHandlersHook={useBottomSheetGestureHandlers}
          {...restProps}
        >
          <BottomSheetContentContainer
            initialIndex={safeInitialIndex}
            isOpen={isOpen}
            progress={progress}
            isDragging={isDragging}
            isPanActivated={isPanActivated}
            isClosingOnSwipe={isClosingOnSwipe}
            contentContainerClassName={contentContainerClassName}
            contentContainerProps={contentContainerProps}
            onOpenChange={onOpenChange}
          >
            {children}
          </BottomSheetContentContainer>
        </StyledBottomSheet>
      </BottomSheetIsDraggingProvider>
    );
  },
);

BottomSheetContent.displayName = 'Lotus.BottomSheetContent';
