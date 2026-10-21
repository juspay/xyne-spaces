import GorhomBottomSheet from '@gorhom/bottom-sheet';
import { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, type Text as RNText } from 'react-native';
import Animated from 'react-native-reanimated';

import { BottomSheetContent as InternalBottomSheetContent } from '@/src/components/ui/bottom-sheet/bottom-sheet-content';
import { FullWindowOverlay } from '@/src/components/full-window-overlay';
import {
  AnimationSettingsProvider,
  useAnimationSettings,
} from '@/src/contexts/animation-settings-context';
import { usePopupOverlayAnimation } from '@/src/hooks/usePopupOverlayAnimation';
import { usePopupRootAnimation } from '@/src/hooks/usePopupRootAnimation';
import { type PressableRef } from '@/src/components/primitives/types';
import * as BottomSheetPrimitives from '@/src/components/primitives/bottom-sheet';
import * as BottomSheetPrimitivesTypes from '@/src/components/primitives/bottom-sheet/bottom-sheet.types';

import {
  BottomSheetAnimationProvider,
  useBottomSheetAnimation,
  DISPLAY_NAME,
} from './bottom-sheet.utils';
import { bottomSheetClassNames, bottomSheetStyleSheet } from './bottom-sheet.styles';
import type {
  BottomSheetCloseProps,
  BottomSheetContentProps,
  BottomSheetDescriptionProps,
  BottomSheetOverlayProps,
  BottomSheetPortalProps,
  BottomSheetRootProps,
  BottomSheetTitleProps,
} from './bottom-sheet.types';

const AnimatedOverlay = Animated.createAnimatedComponent(BottomSheetPrimitives.Overlay);

const useBottomSheet = BottomSheetPrimitives.useRootContext;

// --------------------------------------------------

const BottomSheetRoot = forwardRef<BottomSheetPrimitivesTypes.RootRef, BottomSheetRootProps>(
  ({ children, isOpen: isOpenProp, isDefaultOpen, onOpenChange, animation, ...props }, ref) => {
    const { progress, isDragging, isAllAnimationsDisabled } = usePopupRootAnimation(
      animation !== undefined ? { animation } : {},
    );

    const animationContextValue = useMemo(
      () => ({
        progress,
        isDragging,
      }),
      [progress, isDragging],
    );

    const animationSettingsContextValue = useMemo(
      () => ({
        isAllAnimationsDisabled,
      }),
      [isAllAnimationsDisabled],
    );

    return (
      <AnimationSettingsProvider value={animationSettingsContextValue}>
        <BottomSheetAnimationProvider value={animationContextValue}>
          <BottomSheetPrimitives.Root
            ref={ref}
            {...(isOpenProp !== undefined ? { isOpen: isOpenProp } : {})}
            {...(isDefaultOpen !== undefined ? { isDefaultOpen } : {})}
            {...(onOpenChange !== undefined ? { onOpenChange } : {})}
            {...props}
          >
            {children}
          </BottomSheetPrimitives.Root>
        </BottomSheetAnimationProvider>
      </AnimationSettingsProvider>
    );
  },
);

// --------------------------------------------------

const BottomSheetTrigger = Object.assign(BottomSheetPrimitives.Trigger, {
  displayName: DISPLAY_NAME.TRIGGER,
});

// --------------------------------------------------
const BottomSheetPortal = ({
  children,
  disableFullWindowOverlay = false,
  ...props
}: BottomSheetPortalProps) => {
  const animationSettingsContext = useAnimationSettings();
  const animationContext = useBottomSheetAnimation();

  return (
    <BottomSheetPrimitives.Portal {...props}>
      <AnimationSettingsProvider value={animationSettingsContext}>
        <BottomSheetAnimationProvider value={animationContext}>
          <FullWindowOverlay disableFullWindowOverlay={disableFullWindowOverlay}>
            <Animated.View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
              {children}
            </Animated.View>
          </FullWindowOverlay>
        </BottomSheetAnimationProvider>
      </AnimationSettingsProvider>
    </BottomSheetPrimitives.Portal>
  );
};

// --------------------------------------------------

const BottomSheetOverlay = forwardRef<
  BottomSheetPrimitivesTypes.OverlayRef,
  BottomSheetOverlayProps
>(({ className, style, animation, isAnimatedStyleActive = true, ...props }, ref) => {
  const { isOpen } = useBottomSheet();
  const { progress, isDragging } = useBottomSheetAnimation();

  const overlayClassName = bottomSheetClassNames.overlay({ className });

  const { rContainerStyle } = usePopupOverlayAnimation({
    progress,
    isDragging,
    ...(animation !== undefined ? { animation } : {}),
  });

  if (!isOpen) {
    return null;
  }

  const overlayStyle = isAnimatedStyleActive ? [rContainerStyle, style] : style;

  return (
    <AnimatedOverlay
      ref={ref}
      className={overlayClassName}
      style={overlayStyle}
      pointerEvents={isOpen ? 'auto' : 'none'}
      {...props}
    />
  );
});

// --------------------------------------------------

const BottomSheetContent = forwardRef<GorhomBottomSheet, BottomSheetContentProps>(
  (
    {
      children,
      index: initialIndex,
      backgroundClassName,
      handleIndicatorClassName,
      contentContainerClassName,
      contentContainerProps,
      animationConfigs,
      animation,
      ...restProps
    },
    ref,
  ) => {
    const { isOpen, onOpenChange } = useBottomSheet();
    const { progress, isDragging } = useBottomSheetAnimation();

    return (
      <InternalBottomSheetContent
        ref={ref}
        index={initialIndex ?? 0}
        {...(backgroundClassName !== undefined ? { backgroundClassName } : {})}
        {...(handleIndicatorClassName !== undefined ? { handleIndicatorClassName } : {})}
        {...(contentContainerClassName !== undefined ? { contentContainerClassName } : {})}
        {...(contentContainerProps !== undefined ? { contentContainerProps } : {})}
        {...(animation !== undefined ? { animation } : {})}
        {...(animationConfigs !== undefined ? { animationConfigs } : {})}
        backgroundStyle={[bottomSheetStyleSheet.contentContainer, restProps.backgroundStyle]}
        isOpen={isOpen}
        progress={progress}
        isDragging={isDragging}
        onOpenChange={onOpenChange}
        {...restProps}
      >
        {children}
      </InternalBottomSheetContent>
    );
  },
);

// --------------------------------------------------

const BottomSheetClose = forwardRef<PressableRef, BottomSheetCloseProps>(
  ({ iconProps: _iconProps, ...restProps }, ref) => {
    return <BottomSheetPrimitives.Close ref={ref} {...restProps} />;
  },
);

// --------------------------------------------------

const BottomSheetTitle = forwardRef<RNText, BottomSheetTitleProps>(
  ({ className, children, ...props }, ref) => {
    const { nativeID } = useBottomSheet();
    const titleClassName = bottomSheetClassNames.label({ className });

    return (
      <Text
        ref={ref}
        role='heading'
        accessibilityRole='header'
        nativeID={`${nativeID}_label`}
        className={titleClassName}
        {...props}
      >
        {children}
      </Text>
    );
  },
);

// --------------------------------------------------

const BottomSheetDescription = forwardRef<RNText, BottomSheetDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    const { nativeID } = useBottomSheet();
    const descriptionClassName = bottomSheetClassNames.description({
      className,
    });

    return (
      <Text
        ref={ref}
        accessibilityRole='text'
        nativeID={`${nativeID}_desc`}
        className={descriptionClassName}
        {...props}
      >
        {children}
      </Text>
    );
  },
);

// --------------------------------------------------

BottomSheetRoot.displayName = DISPLAY_NAME.ROOT;
BottomSheetTrigger.displayName = DISPLAY_NAME.TRIGGER;
BottomSheetPortal.displayName = DISPLAY_NAME.PORTAL;
BottomSheetOverlay.displayName = DISPLAY_NAME.OVERLAY;
BottomSheetContent.displayName = DISPLAY_NAME.CONTENT;
BottomSheetClose.displayName = DISPLAY_NAME.CLOSE;
BottomSheetTitle.displayName = DISPLAY_NAME.TITLE;
BottomSheetDescription.displayName = DISPLAY_NAME.DESCRIPTION;

const BottomSheet = Object.assign(BottomSheetRoot, {
  Trigger: BottomSheetTrigger,
  Portal: BottomSheetPortal,
  Overlay: BottomSheetOverlay,
  Content: BottomSheetContent,
  Close: BottomSheetClose,
  Title: BottomSheetTitle,
  Description: BottomSheetDescription,
});

export { useBottomSheet, useBottomSheetAnimation };
export default BottomSheet;
