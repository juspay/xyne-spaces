import { withAlpha } from '@/src/utils/color';
import { haptics } from '@/src/utils/haptics';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type PressableProps,
  type PressableStateCallbackType,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { useCSSVariable } from 'uniwind';

import type {
  DropdownAlign,
  DropdownContentProps,
  DropdownContextValue,
  DropdownItemProps,
  DropdownProps,
  DropdownRect,
  DropdownSeparatorProps,
  DropdownSide,
  DropdownSize,
  DropdownTriggerProps,
} from './types';

const OPEN_DURATION = 150;
const CLOSE_DURATION = 110;
const DEFAULT_EDGE_PADDING = 8;

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext() {
  const context = useContext(DropdownContext);
  if (!context) {
    throw new Error('Dropdown components must be used inside <Dropdown>.');
  }
  return context;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getHorizontalPoint(
  anchorRect: DropdownRect,
  contentWidth: number,
  align: DropdownAlign,
  alignOffset: number,
) {
  if (align === 'start') return anchorRect.x + alignOffset;
  if (align === 'center') {
    return anchorRect.x + anchorRect.width / 2 - contentWidth / 2 + alignOffset;
  }
  return anchorRect.x + anchorRect.width - contentWidth + alignOffset;
}

function getVerticalPoint(
  anchorRect: DropdownRect,
  contentHeight: number,
  align: DropdownAlign,
  alignOffset: number,
) {
  if (align === 'start') return anchorRect.y + alignOffset;
  if (align === 'center') {
    return anchorRect.y + anchorRect.height / 2 - contentHeight / 2 + alignOffset;
  }
  return anchorRect.y + anchorRect.height - contentHeight + alignOffset;
}

function getTransformOrigin(side: DropdownSide, align: DropdownAlign) {
  const horizontal = align === 'end' ? 'right' : align === 'center' ? 'center' : 'left';
  const vertical = align === 'end' ? 'bottom' : align === 'center' ? 'center' : 'top';

  if (side === 'bottom') return `top ${horizontal}`;
  if (side === 'top') return `bottom ${horizontal}`;
  if (side === 'right') return `left ${vertical}`;
  return `right ${vertical}`;
}

function calculatePosition({
  anchorRect,
  contentSize,
  side,
  align,
  sideOffset,
  alignOffset,
  edgePadding,
  screenWidth,
  screenHeight,
  insetTop,
  insetRight,
  insetBottom,
  insetLeft,
}: {
  anchorRect: DropdownRect;
  contentSize: DropdownSize;
  side: DropdownSide;
  align: DropdownAlign;
  sideOffset: number;
  alignOffset: number;
  edgePadding: number;
  screenWidth: number;
  screenHeight: number;
  insetTop: number;
  insetRight: number;
  insetBottom: number;
  insetLeft: number;
}) {
  const minX = insetLeft + edgePadding;
  const maxX = screenWidth - insetRight - edgePadding;
  const minY = insetTop + edgePadding;
  const maxY = screenHeight - insetBottom - edgePadding;
  const maxHeight = Math.max(0, maxY - minY);

  const contentWidth = Math.min(contentSize.width, Math.max(0, maxX - minX));
  const contentHeight = Math.min(contentSize.height, maxHeight);

  // Flip only when the preferred side cannot fit and the opposite side can.
  let resolvedSide = side;
  const bottomTop = anchorRect.y + anchorRect.height + sideOffset;
  const topTop = anchorRect.y - contentHeight - sideOffset;
  const rightLeft = anchorRect.x + anchorRect.width + sideOffset;
  const leftLeft = anchorRect.x - contentWidth - sideOffset;

  if (side === 'bottom' && bottomTop + contentHeight > maxY && topTop >= minY) {
    resolvedSide = 'top';
  } else if (side === 'top' && topTop < minY && bottomTop + contentHeight <= maxY) {
    resolvedSide = 'bottom';
  } else if (side === 'right' && rightLeft + contentWidth > maxX && leftLeft >= minX) {
    resolvedSide = 'left';
  } else if (side === 'left' && leftLeft < minX && rightLeft + contentWidth <= maxX) {
    resolvedSide = 'right';
  }

  let left = anchorRect.x;
  let top = anchorRect.y;

  if (resolvedSide === 'bottom') {
    top = bottomTop;
    left = getHorizontalPoint(anchorRect, contentWidth, align, alignOffset);
  } else if (resolvedSide === 'top') {
    top = topTop;
    left = getHorizontalPoint(anchorRect, contentWidth, align, alignOffset);
  } else if (resolvedSide === 'right') {
    left = rightLeft;
    top = getVerticalPoint(anchorRect, contentHeight, align, alignOffset);
  } else {
    left = leftLeft;
    top = getVerticalPoint(anchorRect, contentHeight, align, alignOffset);
  }

  return {
    left: clamp(left, minX, Math.max(minX, maxX - contentWidth)),
    top: clamp(top, minY, Math.max(minY, maxY - contentHeight)),
    maxHeight,
    transformOrigin: getTransformOrigin(resolvedSide, align),
  };
}

const DropdownRoot = ({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onClosed,
  closeOnSelect = true,
}: DropdownProps) => {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(controlledOpen ?? defaultOpen);
  const [anchorRect, setAnchorRect] = useState<DropdownRect | null>(null);
  const actualOpen = controlledOpen ?? internalOpen;
  const progress = useSharedValue(actualOpen ? 1 : 0);
  const wasOpenRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  const openDropdown = useCallback(
    (nextAnchorRect: DropdownRect) => {
      setAnchorRect(nextAnchorRect);
      setOpen(true);
    },
    [setOpen],
  );

  const closeDropdown = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  useEffect(() => {
    if (actualOpen) {
      wasOpenRef.current = true;
      setMounted(true);
      // Keep hidden until content layout is measured; open animation starts there.
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }

    cancelAnimation(progress);
    progress.value = withTiming(0, {
      duration: CLOSE_DURATION,
      easing: Easing.in(Easing.cubic),
    });

    const shouldNotifyClosed = wasOpenRef.current;
    wasOpenRef.current = false;

    const timeout = setTimeout(() => {
      setMounted(false);
      setAnchorRect(null);
      if (shouldNotifyClosed) onClosedRef.current?.();
    }, CLOSE_DURATION);

    return () => clearTimeout(timeout);
  }, [actualOpen, progress]);

  const value = useMemo(
    () => ({
      isOpen: actualOpen,
      mounted,
      anchorRect,
      progress,
      closeOnSelect,
      openDropdown,
      closeDropdown,
    }),
    [actualOpen, mounted, anchorRect, progress, closeOnSelect, openDropdown, closeDropdown],
  );

  return <DropdownContext.Provider value={value}>{children}</DropdownContext.Provider>;
};

const DropdownTrigger = ({ children, onPress, ...props }: DropdownTriggerProps) => {
  const { openDropdown } = useDropdownContext();
  const triggerRef = useRef<View>(null);

  const handlePress: PressableProps['onPress'] = event => {
    void haptics.buttonTap();
    onPress?.(event);

    // measureInWindow gives coordinates in the same coordinate space as Modal.
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      openDropdown({ x, y, width, height });
    });
  };

  return (
    <Pressable
      ref={triggerRef}
      accessibilityRole='button'
      hitSlop={8}
      {...props}
      onPress={handlePress}
    >
      {children}
    </Pressable>
  );
};

const DropdownContent = ({
  children,
  side = 'bottom',
  align = 'end',
  sideOffset = 8,
  alignOffset = 0,
  edgePadding = DEFAULT_EDGE_PADDING,
  minWidth = 0,
  maxWidth,
  matchTriggerWidth = false,
  overlayColor = 'transparent',
  scrollable = true,
  contentStyle,
  style,
  onLayout,
  ...props
}: DropdownContentProps) => {
  const { isOpen, mounted, anchorRect, progress, closeDropdown } = useDropdownContext();
  const insets = useRawSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const inputColor = useCSSVariable('--color-input') as string;

  // Content size is measured after the first render, then used to clamp the menu
  // against the screen edges.
  const [contentSize, setContentSize] = useState<DropdownSize | null>(null);

  const frameWidth = Math.max(0, screenWidth - insets.left - insets.right - edgePadding * 2);

  const measured = contentSize !== null;

  const position = useMemo(() => {
    if (!anchorRect) {
      return {
        left: insets.left + edgePadding,
        top: insets.top + edgePadding,
        maxHeight: screenHeight - insets.top - insets.bottom - edgePadding * 2,
        transformOrigin: getTransformOrigin(side, align),
      };
    }

    const fallbackContentSize = {
      width: Math.min(frameWidth, Math.max(minWidth, matchTriggerWidth ? anchorRect.width : 0)),
      height: 0,
    };

    return calculatePosition({
      anchorRect,
      contentSize: contentSize ?? fallbackContentSize,
      side,
      align,
      sideOffset,
      alignOffset,
      edgePadding,
      screenWidth,
      screenHeight,
      insetTop: insets.top,
      insetRight: insets.right,
      insetBottom: insets.bottom,
      insetLeft: insets.left,
    });
  }, [
    anchorRect,
    contentSize,
    frameWidth,
    side,
    align,
    sideOffset,
    alignOffset,
    edgePadding,
    minWidth,
    matchTriggerWidth,
    screenWidth,
    screenHeight,
    insets.top,
    insets.right,
    insets.bottom,
    insets.left,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.96, 1]) }],
  }));

  useEffect(() => {
    if (!isOpen || !mounted || !measured) return;

    cancelAnimation(progress);
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: OPEN_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [isOpen, mounted, measured, progress]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setContentSize(previous => {
      if (previous?.width === width && previous.height === height) {
        return previous;
      }
      return { width, height };
    });

    onLayout?.(event);
  };

  useEffect(() => {
    if (!mounted) setContentSize(null);
  }, [mounted]);

  if (!mounted || !anchorRect) return null;

  return (
    <Modal
      transparent
      visible={mounted}
      animationType='none'
      presentationStyle='overFullScreen'
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeDropdown}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Close menu'
          style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]}
          onPress={closeDropdown}
        />

        <Animated.View
          {...props}
          pointerEvents={measured ? 'auto' : 'none'}
          onLayout={handleLayout}
          style={[
            styles.content,
            {
              left: position.left,
              top: position.top,
              backgroundColor: inputColor,
              maxHeight: position.maxHeight,
              maxWidth: maxWidth ? Math.min(maxWidth, frameWidth) : frameWidth,
              minWidth: Math.max(minWidth, matchTriggerWidth ? anchorRect.width : 0),
              transformOrigin: position.transformOrigin,
            },
            style,
            animatedStyle,
            !measured && styles.hidden,
          ]}
        >
          {scrollable ? (
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.scrollContent, contentStyle]}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={contentStyle}>{children}</View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

const DropdownItem = ({
  children,
  label,
  left,
  right,
  danger = false,
  disabled = false,
  closeOnSelect,
  onSelect,
  onPress,
  style,
  labelStyle,
  ...props
}: DropdownItemProps) => {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const pressedBackgroundColor = withAlpha(foregroundColor, 0.1);

  const { closeDropdown, closeOnSelect: rootCloseOnSelect } = useDropdownContext();

  const handlePress: PressableProps['onPress'] = event => {
    if (disabled) return;

    // Selection haptics feel closer to native menus than a heavy impact.
    void haptics.selection();
    onPress?.(event);
    onSelect?.();

    if (closeOnSelect ?? rootCloseOnSelect) {
      closeDropdown();
    }
  };

  const resolveStyle = (state: PressableStateCallbackType) => [
    styles.item,
    state.pressed &&
      !disabled && {
        backgroundColor: pressedBackgroundColor,
      },
    disabled && styles.itemDisabled,
    typeof style === 'function' ? style(state) : style,
  ];

  return (
    <Pressable
      accessibilityRole='menuitem'
      disabled={disabled}
      {...props}
      onPress={handlePress}
      style={resolveStyle}
    >
      {children ?? (
        <>
          {left ? <View style={styles.itemIcon}>{left}</View> : null}
          <Text
            numberOfLines={1}
            style={[
              styles.itemLabel,
              { color: foregroundColor },
              danger && styles.itemLabelDanger,
              labelStyle,
            ]}
          >
            {label}
          </Text>
          {right ? <View style={styles.itemRight}>{right}</View> : null}
        </>
      )}
    </Pressable>
  );
};

const DropdownSeparator = ({ style, ...props }: DropdownSeparatorProps) => {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const separatorColor = withAlpha(foregroundColor, 0.08);

  return <View {...props} style={[styles.separator, { backgroundColor: separatorColor }, style]} />;
};

type DropdownComponent = React.FC<DropdownProps> & {
  Trigger: React.FC<DropdownTriggerProps>;
  Content: React.FC<DropdownContentProps>;
  Item: React.FC<DropdownItemProps>;
  Separator: React.FC<DropdownSeparatorProps>;
};

const Dropdown = Object.assign(DropdownRoot, {
  Trigger: DropdownTrigger,
  Content: DropdownContent,
  Item: DropdownItem,
  Separator: DropdownSeparator,
}) as DropdownComponent;

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  content: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 14,
  },
  hidden: {
    opacity: 0,
  },
  scrollContent: {
    paddingVertical: 0,
  },
  item: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  itemDisabled: {
    opacity: 0.45,
  },
  itemIcon: {
    width: 20,
    marginRight: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  itemLabelDanger: {
    color: '#FF6B6B',
  },
  itemRight: {
    marginLeft: 14,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 1,
  },
});

export default Dropdown;
