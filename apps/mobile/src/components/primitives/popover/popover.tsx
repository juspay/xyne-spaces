import React, { useContext, useEffect, useId, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type LayoutRectangle,
} from 'react-native';

import { useRelativePosition } from '@/src/hooks/useRelativePosition';
import { useAugmentedRef } from '@/src/hooks/useAugmentedRef';
import { type LayoutPosition } from '@/src/hooks/useRelativePosition';
import { DEFAULT_PORTAL_HOST, Portal as PrimitivePortal } from '@/src/components/primitives/portal';
import * as Slot from '@/src/components/primitives/slot';

import type {
  CloseProps,
  CloseRef,
  ContentProps,
  ContentRef,
  IRootContext,
  OverlayProps,
  OverlayRef,
  PortalProps,
  RootProps,
  RootRef,
  TriggerProps,
  TriggerRef,
} from './popover.types';
import { useControllableState } from '@/src/hooks/useControllableState';

const RootContext = React.createContext<IRootContext | null>(null);

const useRootContext = () => {
  const context = useContext(RootContext);
  if (!context) {
    throw new Error('Popover compound components cannot be rendered outside the Popover component');
  }
  return context;
};

const Root = React.forwardRef<RootRef, RootProps>(
  (
    {
      asChild,
      children,
      isOpen: isOpenProp,
      isDefaultOpen,
      onOpenChange: onOpenChangeProp,
      isDisabled,
      presentation = 'popover',
      ...viewProps
    },
    ref,
  ) => {
    const [isOpen = false, onOpenChange] = useControllableState({
      prop: isOpenProp,
      defaultProp: isDefaultOpen,
      onChange: onOpenChangeProp,
    });

    const [triggerPosition, setTriggerPosition] = useState<LayoutPosition | null>(null);
    const [contentLayout, setContentLayout] = useState<LayoutRectangle | null>(null);

    const nativeID = useId();

    const Component = asChild ? Slot.View : View;

    return (
      <RootContext.Provider
        value={{
          isOpen,
          onOpenChange,
          isDisabled: isDisabled ?? false,
          contentLayout,
          nativeID,
          setContentLayout,
          setTriggerPosition,
          triggerPosition,
          isDefaultOpen: isDefaultOpen ?? false,
          presentation,
        }}
      >
        <Component ref={ref} {...viewProps}>
          {children}
        </Component>
      </RootContext.Provider>
    );
  },
);

// --------------------------------------------------

const Trigger = React.forwardRef<TriggerRef, TriggerProps>(
  ({ asChild, onPress: onPressProp, isDisabled = false, ...restProps }, ref) => {
    const {
      onOpenChange,
      isOpen,
      isDisabled: isDisabledRoot,
      setTriggerPosition,
      setContentLayout,
      isDefaultOpen,
      triggerPosition,
    } = useRootContext();

    const isDisabledValue = isDisabled ?? isDisabledRoot ?? undefined;

    function measureTrigger(): void {
      const node = augmentedRef.current;
      if (!node) return;

      if (Platform.OS === 'android' && typeof node.measureInWindow === 'function') {
        node.measureInWindow((pageX, pageY, width, height) => {
          setTriggerPosition({ width, pageX, pageY, height });
        });
        return;
      }

      node.measure((_x, _y, width, height, pageX, pageY) => {
        setTriggerPosition({ width, pageX, pageY, height });
      });
    }

    const augmentedRef = useAugmentedRef({
      ref,
      methods: {
        open: () => {
          measureTrigger();
          onOpenChange(true);
        },
        close: () => {
          onOpenChange(false);
          setTriggerPosition(null);
          setContentLayout(null);
        },
      },
      deps: [isOpen],
    });

    // Open popover on mount if isDefaultOpen is true
    useEffect(() => {
      if ((isDefaultOpen || isOpen) && !triggerPosition) {
        // Use setTimeout to ensure the component is mounted and can be measured
        const timeoutId = setTimeout(() => {
          measureTrigger();
          if (isDefaultOpen) {
            onOpenChange(true);
          }
        }, 0);
        return () => clearTimeout(timeoutId);
      }
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (isOpen) {
        const timeoutId = setTimeout(() => {
          measureTrigger();
        }, 0);
        return () => clearTimeout(timeoutId);
      }
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    function onPress(ev: GestureResponderEvent) {
      measureTrigger();
      onOpenChange(!isOpen);
      onPressProp?.(ev);
    }

    const Component = asChild ? Slot.Pressable : Pressable;

    return (
      <Component
        ref={augmentedRef}
        aria-disabled={isDisabledValue}
        role='button'
        onPress={onPress}
        disabled={isDisabledValue}
        {...restProps}
      />
    );
  },
);

// --------------------------------------------------

/**
 * @warning when using a custom `<PortalHost />`, you might have to adjust the Content's offset to account for nav elements like headers.
 */
const Portal = ({ forceMount, hostName = DEFAULT_PORTAL_HOST, children }: PortalProps) => {
  const value = useRootContext();

  const isBottomSheet = value.presentation === 'bottom-sheet';

  if (!value.triggerPosition && !isBottomSheet) {
    return null;
  }

  if (!forceMount && !isBottomSheet) {
    if (!value.isOpen) {
      return null;
    }
  }

  return (
    <PrimitivePortal hostName={hostName} name={`${value.nativeID}_portal`}>
      <RootContext.Provider value={value}>{children}</RootContext.Provider>
    </PrimitivePortal>
  );
};

// --------------------------------------------------

const Overlay = React.forwardRef<OverlayRef, OverlayProps>(
  ({ asChild, forceMount, onPress: OnPressProp, closeOnPress = true, ...props }, ref) => {
    const { isOpen, onOpenChange, setTriggerPosition, setContentLayout } = useRootContext();

    function onPress(ev: GestureResponderEvent) {
      if (closeOnPress) {
        onOpenChange(false);
        setTriggerPosition(null);
        setContentLayout(null);
      }
      OnPressProp?.(ev);
    }

    if (!forceMount) {
      if (!isOpen) {
        return null;
      }
    }

    const Component = asChild ? Slot.Pressable : Pressable;

    return <Component ref={ref} onPress={onPress} {...props} />;
  },
);

// --------------------------------------------------

/**
 * @info `position`, `top`, `left`, and `maxWidth` style properties are controlled internally. Opt out of this behavior by setting `disablePositioningStyle` to `true`.
 */
const Content = React.forwardRef<ContentRef, ContentProps>(
  (
    {
      asChild = false,
      forceMount,
      align = 'start',
      placement = 'bottom',
      offset = 0,
      alignOffset = 0,
      avoidCollisions = true,
      onLayout: onLayoutProp,
      insets,
      style,
      disablePositioningStyle,
      width = 'content-fit',
      ...props
    },
    ref,
  ) => {
    const {
      isOpen,
      onOpenChange,
      contentLayout,
      nativeID,
      setContentLayout,
      setTriggerPosition,
      triggerPosition,
    } = useRootContext();

    useEffect(() => {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        onOpenChange(false);
        setTriggerPosition(null);
        setContentLayout(null);
        return true;
      });

      return () => {
        setContentLayout(null);
        backHandler.remove();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const positionStyle = useRelativePosition({
      align,
      avoidCollisions,
      triggerPosition,
      contentLayout,
      alignOffset,
      insets: insets ?? { top: 0, left: 0, right: 0, bottom: 0 },
      offset,
      placement,
      disablePositioningStyle: disablePositioningStyle ?? false,
    });

    // Calculate content width based on width prop
    const widthStyle: { width?: number | `${number}%` } = {};
    if (width === 'trigger' && triggerPosition) {
      widthStyle.width = triggerPosition.width;
    } else if (width === 'full') {
      widthStyle.width = '100%';
    } else if (typeof width === 'number') {
      widthStyle.width = width;
    }
    // 'content-fit' is default - no explicit width set

    function onLayout(event: LayoutChangeEvent) {
      setContentLayout(event.nativeEvent.layout);
      onLayoutProp?.(event);
    }

    if (!forceMount) {
      if (!isOpen) {
        return null;
      }
    }

    const Component = asChild ? Slot.View : View;

    return (
      <Component
        ref={ref}
        role='dialog'
        nativeID={nativeID}
        aria-modal={true}
        style={[positionStyle, widthStyle, style]}
        onLayout={onLayout}
        {...props}
      />
    );
  },
);

// --------------------------------------------------

const Close = React.forwardRef<CloseRef, CloseProps>(
  ({ asChild, onPress: onPressProp, disabled = false, ...props }, ref) => {
    const { onOpenChange, setContentLayout, setTriggerPosition } = useRootContext();

    function onPress(ev: GestureResponderEvent) {
      if (disabled) return;
      onOpenChange(false);
      setTriggerPosition(null);
      setContentLayout(null);
      onPressProp?.(ev);
    }

    const Component = asChild ? Slot.Pressable : Pressable;

    return (
      <Component
        ref={ref}
        aria-disabled={disabled ?? undefined}
        role='button'
        onPress={onPress}
        disabled={disabled ?? undefined}
        {...props}
      />
    );
  },
);

// --------------------------------------------------

Root.displayName = 'Lotus.Popover.Root';
Trigger.displayName = 'Lotus.Popover.Trigger';
Overlay.displayName = 'Lotus.Popover.Overlay';
Content.displayName = 'Lotus.Popover.Content';
Close.displayName = 'Lotus.Popover.Close';

export { Close, Content, Overlay, Portal, Root, Trigger, useRootContext };
