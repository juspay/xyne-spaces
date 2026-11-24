import {
  useCallback,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type Text,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import {
  PLUS_TRAY_BODY_PADDING_TOP,
  PLUS_TRAY_BODY_PADDING_X,
  PLUS_TRAY_BOTTOM_GAP,
  PLUS_TRAY_DRAG_ACTIVATION,
  PLUS_TRAY_LAST_SECTION_RADIUS,
  PLUS_TRAY_MOTION_MS,
  PLUS_TRAY_PADDING_BOTTOM,
  PLUS_TRAY_RADIUS,
  PLUS_TRAY_SECTION_GAP,
  PLUS_TRAY_SECTION_RADIUS,
  PLUS_TRAY_SIDE_INSET,
  PLUS_TRAY_TOP_GAP,
  TRAY_SHADOW,
} from '../constants';
import { floatingCardBottom } from '../model/floating-card';
import { trayDragCloses } from '../model/tray-card';
import { ConversationOverlayLayer } from './conversation-overlay-layer';
import { ConversationScrim } from './conversation-scrim';
import { PlusTrayHeader } from './plus-tray-header';

const MOTION = {
  duration: PLUS_TRAY_MOTION_MS,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

/** A tray card's slide, which its owner drives to put the card away before acting. */
export type TrayCardMotion = Readonly<{
  /** 0 hidden, 1 up. */
  progress: SharedValue<number>;
  /** Slides the card away; resolves once it is gone. Later calls get the same promise. */
  hide: () => Promise<void>;
  /** Whether `hide` has been called. */
  isHiding: () => boolean;
}>;

export function useTrayCardMotion(): TrayCardMotion {
  const progress = useSharedValue(0);
  const hiding = useRef<Promise<void> | null>(null);

  const hide = useCallback((): Promise<void> => {
    hiding.current ??= new Promise<void>(resolve => {
      progress.set(withTiming(0, MOTION, () => scheduleOnRN(resolve)));
    });
    return hiding.current;
  }, [progress]);
  const isHiding = useCallback((): boolean => hiding.current !== null, []);

  return useMemo(() => ({ progress, hide, isHiding }), [hide, isHiding, progress]);
}

type TrayCardProps = {
  motion: TrayCardMotion;
  title: string;
  /** The scrim, the close plate, back, Escape or a drag down. */
  onDismiss: () => void;
  /** Off while the body holds something that turns on vertical drags. On by default. */
  dragToClose?: boolean;
  /** The body: section cards, 10 apart, scrolling when they outgrow the screen. */
  children: ReactNode;
};

/**
 * The room's floating tray (Figma "Plus tray"): a card over the screen and the
 * typing bar on a scrim, with a title and close plate over scrolling section
 * cards. It slides up as the scrim fades in, then moves screen readers to its
 * title; dismissing is left to the owner, which hides `motion` first.
 */
export function TrayCard({
  motion,
  title,
  onDismiss,
  dragToClose = true,
  children,
}: TrayCardProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { progress, isHiding } = motion;

  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  const opened = useRef(false);
  // Off-screen until the card has been measured.
  const hiddenOffset = useSharedValue(windowHeight);
  const dragY = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useScrollOffset(scrollRef);

  const bottom = floatingCardBottom(PLUS_TRAY_BOTTOM_GAP, insets.bottom, Platform.OS === 'android');
  const frameStyle = useMemo(
    () => [styles.frame, { paddingTop: insets.top + PLUS_TRAY_TOP_GAP, paddingBottom: bottom }],
    [bottom, insets.top],
  );

  const focusTitle = useCallback((): void => {
    const node = titleRef.current;
    if (node !== null) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, []);

  const handleCardLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      hiddenOffset.set(event.nativeEvent.layout.height + bottom);
      if (opened.current || isHiding()) return;
      opened.current = true;
      progress.set(
        withTiming(1, MOTION, finished => {
          if (finished) scheduleOnRN(focusTitle);
        }),
      );
    },
    [bottom, focusTitle, hiddenOffset, isHiding, progress],
  );

  const gestures = useMemo(() => {
    const scroll = Gesture.Native();
    const drag = Gesture.Pan()
      .enabled(dragToClose)
      .activeOffsetY(PLUS_TRAY_DRAG_ACTIVATION)
      .failOffsetY(-PLUS_TRAY_DRAG_ACTIVATION)
      .simultaneousWithExternalGesture(scroll)
      .onStart(() => {
        dragOrigin.set(0);
      })
      .onUpdate(event => {
        // While the rows are scrolled, the drag scrolls them back first.
        if (scrollOffset.get() > 0) {
          dragOrigin.set(event.translationY);
          return;
        }
        dragY.set(Math.max(0, event.translationY - dragOrigin.get()));
      })
      .onEnd((event, success) => {
        if (success && trayDragCloses(dragY.get(), event.velocityY)) {
          scheduleOnRN(onDismiss);
          return;
        }
        dragY.set(withTiming(0, MOTION));
      });
    return { scroll, drag };
  }, [dragOrigin, dragToClose, dragY, onDismiss, scrollOffset]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * hiddenOffset.get() + dragY.get() }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * (1 - Math.min(1, dragY.get() / hiddenOffset.get())),
  }));

  return (
    <ConversationOverlayLayer android='portal' onRequestClose={onDismiss}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <ConversationScrim label='Close' onPress={onDismiss} />
        </Animated.View>
        <View style={frameStyle} pointerEvents='box-none'>
          <GestureDetector gesture={gestures.drag}>
            <Animated.View
              className='bg-spaces-surface-raised'
              style={[styles.card, cardStyle]}
              onLayout={handleCardLayout}
              accessibilityViewIsModal
              onAccessibilityEscape={onDismiss}
            >
              {/* A separate clip, because clipping the shadowed view would clip its shadow on iOS. */}
              <View style={styles.clip}>
                <PlusTrayHeader title={title} titleRef={titleRef} onClose={onDismiss} />
                <GestureDetector gesture={gestures.scroll}>
                  <Animated.ScrollView
                    ref={scrollRef}
                    bounces={false}
                    overScrollMode='never'
                    keyboardShouldPersistTaps='handled'
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                  >
                    {children}
                  </Animated.ScrollView>
                </GestureDetector>
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </ConversationOverlayLayer>
  );
}

type TrayCardSectionProps = {
  /** The bottom card, whose lower corners follow the tray's. */
  last: boolean;
  children: ReactNode;
};

/** One of the tray's section cards: rows on the surface, radius 16. */
export function TrayCardSection({ last, children }: TrayCardSectionProps): ReactElement {
  return (
    <View
      className='overflow-hidden bg-spaces-surface'
      style={last ? styles.lastSection : styles.section}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    paddingHorizontal: PLUS_TRAY_SIDE_INSET,
  },
  card: { flexShrink: 1, borderRadius: PLUS_TRAY_RADIUS, ...TRAY_SHADOW },
  clip: {
    flexShrink: 1,
    borderRadius: PLUS_TRAY_RADIUS,
    overflow: 'hidden',
    paddingBottom: PLUS_TRAY_PADDING_BOTTOM,
  },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: {
    paddingTop: PLUS_TRAY_BODY_PADDING_TOP,
    paddingHorizontal: PLUS_TRAY_BODY_PADDING_X,
    rowGap: PLUS_TRAY_SECTION_GAP,
  },
  section: { borderRadius: PLUS_TRAY_SECTION_RADIUS },
  lastSection: {
    borderTopLeftRadius: PLUS_TRAY_SECTION_RADIUS,
    borderTopRightRadius: PLUS_TRAY_SECTION_RADIUS,
    borderBottomLeftRadius: PLUS_TRAY_LAST_SECTION_RADIUS,
    borderBottomRightRadius: PLUS_TRAY_LAST_SECTION_RADIUS,
  },
});
