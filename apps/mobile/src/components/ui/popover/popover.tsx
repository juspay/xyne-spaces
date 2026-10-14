import BottomSheet from '@gorhom/bottom-sheet';
import { createContext, forwardRef, useMemo } from 'react';
import type { Text as RNText } from 'react-native';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/src/utils/cn';

import { usePopupOverlayAnimation } from '@/src/hooks/usePopupOverlayAnimation';
import { usePopupPopoverContentAnimation } from '@/src/hooks/usePopupPopoverContentAnimation';
import { usePopupRootAnimation } from '@/src/hooks/usePopupRootAnimation';

import { type PressableRef } from '../../primitives/types';
import * as PopoverPrimitives from '@/src/components/primitives/popover';
import * as PopoverPrimitivesTypes from '@/src/components/primitives/popover/popover.types';
import { PopoverAnimationProvider, usePopoverAnimation } from './popover.utils';

import {
  DEFAULT_ALIGN_OFFSET,
  DEFAULT_INSETS,
  DEFAULT_OFFSET,
  DISPLAY_NAME,
} from './popover.utils';

import { popoverClassNames, popoverStyleSheet } from './popover.styles';
import type {
  PopoverCloseProps,
  PopoverContentBottomSheetProps,
  PopoverContentContextValue,
  PopoverContentPopoverProps,
  PopoverContentProps,
  PopoverDescriptionProps,
  PopoverOverlayProps,
  PopoverPortalProps,
  PopoverRootProps,
  PopoverTitleProps,
} from './popover.types';
import {
  AnimationSettingsProvider,
  useAnimationSettings,
} from '@/src/contexts/animation-settings-context';
import { FullWindowOverlay } from '@/src/components/full-window-overlay';
import { BottomSheetContent } from '../bottom-sheet/bottom-sheet-content';

const AnimatedOverlay = Animated.createAnimatedComponent(PopoverPrimitives.Overlay);

const AnimatedContent = Animated.createAnimatedComponent(PopoverPrimitives.Content);

const usePopover = PopoverPrimitives.useRootContext;

const POPOVER_PORTAL_LAYER_STYLE =
  Platform.OS === 'android'
    ? {
        zIndex: 11000,
        elevation: 11000,
      }
    : undefined;

const PopoverContentContext = createContext<PopoverContentContextValue>({
  placement: undefined,
});

// --------------------------------------------------

const PopoverRoot = forwardRef<PopoverPrimitivesTypes.RootRef, PopoverRootProps>(
  (
    {
      children,
      isOpen: isOpenProp,
      isDefaultOpen,
      onOpenChange: onOpenChangeProp,
      presentation = 'popover',
      animation,
      ...props
    },
    ref,
  ) => {
    const { isAllAnimationsDisabled, progress, isDragging } = usePopupRootAnimation({
      ...(animation !== undefined && { animation }),
    });

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
        <PopoverAnimationProvider value={animationContextValue}>
          <PopoverPrimitives.Root
            ref={ref}
            presentation={presentation}
            {...(isOpenProp !== undefined && { isOpen: isOpenProp })}
            {...(isDefaultOpen !== undefined && { isDefaultOpen })}
            {...(onOpenChangeProp !== undefined && { onOpenChange: onOpenChangeProp })}
            {...props}
          >
            {children}
          </PopoverPrimitives.Root>
        </PopoverAnimationProvider>
      </AnimationSettingsProvider>
    );
  },
);

// --------------------------------------------------

const PopoverTrigger = Object.assign(PopoverPrimitives.Trigger, {
  displayName: DISPLAY_NAME.TRIGGER,
});

// --------------------------------------------------

const PopoverPortal = ({
  className,
  children,
  disableFullWindowOverlay = false,
  ...props
}: PopoverPortalProps): React.ReactElement => {
  const animationSettingsContext = useAnimationSettings();
  const animationContext = usePopoverAnimation();
  const portalClassName = popoverClassNames.portal({ className });

  return (
    <PopoverPrimitives.Portal {...props}>
      <AnimationSettingsProvider value={animationSettingsContext}>
        <PopoverAnimationProvider value={animationContext}>
          <FullWindowOverlay disableFullWindowOverlay={disableFullWindowOverlay}>
            <View
              className={portalClassName}
              pointerEvents='box-none'
              style={POPOVER_PORTAL_LAYER_STYLE}
            >
              {children}
            </View>
          </FullWindowOverlay>
        </PopoverAnimationProvider>
      </AnimationSettingsProvider>
    </PopoverPrimitives.Portal>
  );
};

// --------------------------------------------------

const PopoverOverlay = forwardRef<PopoverPrimitivesTypes.OverlayRef, PopoverOverlayProps>(
  ({ className, style, animation, isAnimatedStyleActive = true, ...props }, ref) => {
    const { isOpen, presentation } = usePopover();
    const { progress, isDragging } = usePopoverAnimation();

    const overlayClassName = popoverClassNames.overlay({ className });

    const { rContainerStyle, entering, exiting } = usePopupOverlayAnimation({
      ...(presentation === 'bottom-sheet' && { progress, isDragging }),
      ...(animation !== undefined && { animation }),
    });

    const overlayStyle = isAnimatedStyleActive ? [rContainerStyle, style] : style;

    return (
      <Animated.View
        {...(entering !== undefined && { entering })}
        {...(exiting !== undefined && { exiting })}
        style={StyleSheet.absoluteFill}
        pointerEvents='box-none'
      >
        <AnimatedOverlay
          ref={ref}
          className={overlayClassName}
          style={overlayStyle}
          forceMount={presentation === 'bottom-sheet' ? true : undefined}
          pointerEvents={isOpen ? 'auto' : 'none'}
          {...props}
        />
      </Animated.View>
    );
  },
);

// --------------------------------------------------

const PopoverContentPopover = forwardRef<
  PopoverPrimitivesTypes.ContentRef,
  PopoverContentPopoverProps
>(function PopoverContentPopover(
  {
    placement = 'bottom',
    align = 'center',
    avoidCollisions = true,
    offset = DEFAULT_OFFSET,
    alignOffset = DEFAULT_ALIGN_OFFSET,
    className,
    children,
    style,
    animation,
    insets: _insets,
    ...props
  },
  ref,
) {
  const { contentLayout } = usePopover();

  const safeAreaInsets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const isReady = Boolean(contentLayout?.y && contentLayout.y < screenHeight);

  const cInsets = {
    top: DEFAULT_INSETS.top + safeAreaInsets.top,
    bottom: DEFAULT_INSETS.bottom + safeAreaInsets.bottom,
    left: DEFAULT_INSETS.left + safeAreaInsets.left,
    right: DEFAULT_INSETS.right + safeAreaInsets.right,
  };

  const contentClassName = popoverClassNames.content({ className });

  const { entering, exiting } = usePopupPopoverContentAnimation({
    placement,
    offset,
    ...(animation !== undefined && { animation }),
  });

  return (
    <PopoverContentContext value={{ placement }}>
      {isReady && (
        <AnimatedContent
          ref={ref}
          {...(entering !== undefined && { entering })}
          {...(exiting !== undefined && { exiting })}
          placement={placement}
          align={align}
          avoidCollisions={avoidCollisions}
          offset={offset}
          alignOffset={alignOffset}
          className={contentClassName}
          insets={cInsets}
          style={[popoverStyleSheet.contentContainer, style]}
          {...props}
        >
          {children}
        </AnimatedContent>
      )}
      <AnimatedContent
        placement={placement}
        accessible={false}
        accessibilityElementsHidden={true}
        importantForAccessibility='no'
        pointerEvents='none'
        collapsable={false}
        align={align}
        avoidCollisions={avoidCollisions}
        offset={offset}
        alignOffset={alignOffset}
        insets={cInsets}
        className={cn(contentClassName, 'absolute opacity-0')}
        style={[popoverStyleSheet.contentContainer, style]}
        {...props}
      >
        {children}
      </AnimatedContent>
    </PopoverContentContext>
  );
});

// --------------------------------------------------

const PopoverContentBottomSheet = forwardRef<BottomSheet, PopoverContentBottomSheetProps>(
  function PopoverContentBottomSheet(
    {
      children,
      index: initialIndex,
      backgroundClassName,
      handleIndicatorClassName,
      contentContainerClassName: contentContainerClassNameProp,
      contentContainerProps,
      animation,
      animationConfigs,
      ...restProps
    },
    ref,
  ) {
    const { isOpen, onOpenChange } = usePopover();

    const { progress, isDragging } = usePopoverAnimation();

    return (
      <BottomSheetContent
        ref={ref}
        index={initialIndex ?? 0}
        {...(backgroundClassName !== undefined ? { backgroundClassName } : {})}
        {...(handleIndicatorClassName !== undefined ? { handleIndicatorClassName } : {})}
        {...(contentContainerClassNameProp !== undefined
          ? { contentContainerClassName: contentContainerClassNameProp }
          : {})}
        {...(contentContainerProps !== undefined ? { contentContainerProps } : {})}
        {...(animation !== undefined && { animation })}
        {...(animationConfigs !== undefined && { animationConfigs })}
        backgroundStyle={[popoverStyleSheet.contentContainer, restProps.backgroundStyle]}
        isOpen={isOpen}
        progress={progress}
        isDragging={isDragging}
        onOpenChange={onOpenChange}
        {...restProps}
      >
        {children}
      </BottomSheetContent>
    );
  },
);

// --------------------------------------------------

const PopoverContent = forwardRef<
  PopoverPrimitivesTypes.ContentRef | BottomSheet,
  PopoverContentProps
>((props, ref) => {
  const { presentation: contextPresentation } = usePopover();

  if (__DEV__) {
    if (props.presentation !== contextPresentation) {
      throw new Error(
        `Popover.Content presentation prop ("${props.presentation}") does not match Popover.Root presentation prop ("${contextPresentation}"). They must be the same.`,
      );
    }
  }

  if (props.presentation === 'bottom-sheet') {
    return (
      <PopoverContentBottomSheet
        ref={ref as React.Ref<BottomSheet>}
        {...(props as PopoverContentBottomSheetProps)}
      />
    );
  }

  return (
    <PopoverContentPopover
      ref={ref as React.Ref<PopoverPrimitivesTypes.ContentRef>}
      {...(props as PopoverContentPopoverProps)}
    />
  );
});

// --------------------------------------------------

const PopoverClose = forwardRef<PressableRef, PopoverCloseProps>(
  ({ iconProps: _iconProps, ...restProps }, ref) => {
    return <PopoverPrimitives.Close ref={ref} {...restProps} />;
  },
);

// --------------------------------------------------

const PopoverTitle = forwardRef<RNText, PopoverTitleProps>(
  ({ className, children, ...props }, ref) => {
    const titleClassName = popoverClassNames.label({ className });

    return (
      <Text
        ref={ref}
        role='heading'
        accessibilityRole='header'
        className={titleClassName}
        {...props}
      >
        {children}
      </Text>
    );
  },
);

// --------------------------------------------------

const PopoverDescription = forwardRef<RNText, PopoverDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    const descriptionClassName = popoverClassNames.description({ className });

    return (
      <Text ref={ref} accessibilityRole='text' className={descriptionClassName} {...props}>
        {children}
      </Text>
    );
  },
);

// --------------------------------------------------

PopoverRoot.displayName = DISPLAY_NAME.ROOT;
PopoverTrigger.displayName = DISPLAY_NAME.TRIGGER;
PopoverPortal.displayName = DISPLAY_NAME.PORTAL;
PopoverOverlay.displayName = DISPLAY_NAME.OVERLAY;
PopoverContent.displayName = DISPLAY_NAME.CONTENT;
PopoverClose.displayName = DISPLAY_NAME.CLOSE;
PopoverTitle.displayName = DISPLAY_NAME.TITLE;
PopoverDescription.displayName = DISPLAY_NAME.DESCRIPTION;

const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Portal: PopoverPortal,
  Overlay: PopoverOverlay,
  Content: PopoverContent,
  Close: PopoverClose,
  Title: PopoverTitle,
  Description: PopoverDescription,
});

export { usePopover, usePopoverAnimation };
export default Popover;
