import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { FullWindowOverlay } from '@/src/components/full-window-overlay';
import type { MessageActionsViewProps } from '@/src/features/chat/v2/components/message-actions-sheet';
import { QUICK_REACTIONS } from '@/src/features/chat/v2/components/message-actions-sheet';
import { haptics } from '@/src/utils/haptics';

import {
  HOLD_BACKDROP_OPACITY,
  HOLD_DESTRUCTIVE_COLOR,
  HOLD_MENU_ICON_SIZE,
  HOLD_MENU_PADDING_Y,
  HOLD_MENU_RADIUS,
  HOLD_MENU_ROW_GAP,
  HOLD_MENU_ROW_HEIGHT,
  HOLD_MENU_ROW_PADDING_X,
  HOLD_RAIL_HEIGHT,
  HOLD_RAIL_PADDING,
  HOLD_REACTION_EMOJI_SIZE,
  HOLD_REACTION_SIZE,
  HOLD_SIDE_INSET,
} from '../constants';
import { computeHoldLayout, orderHoldMenuActions, type HoldRect } from '../model/hold-menu';
import { claimHoldHaptic, clearHoldSource, getHoldSource } from '../model/hold-source-store';
import { ConversationPaletteProvider } from './conversation-palette';

const ENTER_MS = 200;
const EXIT_MS = 140;
const EASE_OUT = Easing.out(Easing.cubic);
/** Longest the first measure waits for the keyboard to finish hiding. */
const KEYBOARD_WAIT_MS = 600;
/** Moves focus to the first item once the enter animation has laid things out. */
const FOCUS_DELAY_MS = ENTER_MS + 50;
/** Without a separate window the root has to out-stack the screen's headers and composer. */
const ANDROID_LAYER_STYLE =
  Platform.OS === 'android' ? ({ zIndex: 11000, elevation: 11000 } as const) : undefined;

const SHADOW_RAIL = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 8,
} as const;
/** The Figma "Tray" shadow. */
const SHADOW_TRAY = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.16,
  shadowRadius: 24,
  elevation: 12,
} as const;

/**
 * The redesigned message hold: the screen dims, the held message is lifted as a
 * card in place, a reaction rail sits above it and the actions below.
 *
 * It replaces only the classic sheet's `actions` view (see `ActionsView` on
 * `MessageActionsSheet`); the sheet still owns forward, the emoji picker, the
 * keyboard wait, back handling and what runs after dismissal.
 */
export function HoldMenu({
  target,
  actions,
  isOpen,
  showReactionRail,
  onReact,
  onOpenEmojiPicker,
  onRequestClose,
  onDismissed,
}: MessageActionsViewProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [overlaySize, setOverlaySize] = useState<{ width: number; height: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const foreground = useCSSVariable('--color-spaces-foreground') as string;

  const rootRef = useRef<View>(null);
  const [rect, setRect] = useState<HoldRect | null>(null);
  const [ready, setReady] = useState(false);
  const [source] = useState(() => getHoldSource(target.conversationId));
  const firstItemRef = useRef<View>(null);
  const measureToken = useRef(0);

  const progress = useSharedValue(0);
  const dismissedRef = useRef(false);
  const onDismissedRef = useRef(onDismissed);
  useEffect(() => {
    onDismissedRef.current = onDismissed;
  });
  const finishDismiss = useCallback((): void => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearHoldSource();
    onDismissedRef.current();
  }, []);

  // Where the overlay and the held row are in the window. Both are read in
  // window coordinates, so it holds wherever the overlay is mounted.
  const measure = useCallback((): void => {
    const root = rootRef.current;
    const token = ++measureToken.current;
    if (!root) {
      setReady(true);
      return;
    }
    root.measureInWindow((originX, originY) => {
      if (token !== measureToken.current) return;
      if (!source) {
        setReady(true);
        return;
      }
      source.measure(held => {
        if (token !== measureToken.current) return;
        setRect(
          held
            ? { x: held.x - originX, y: held.y - originY, width: held.width, height: held.height }
            : null,
        );
        setReady(true);
      });
    });
  }, [source]);

  const cancelMeasure = useCallback((): void => {
    measureToken.current += 1;
  }, []);

  // The sheet starts hiding the keyboard as it opens, and the row moves when
  // the list settles, so measure once the keyboard is gone (with a fallback so
  // a missed event never leaves the menu blank) and again whenever it hides.
  useLayoutEffect(() => {
    const hideSub = Keyboard.addListener('keyboardDidHide', measure);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (Keyboard.isVisible()) {
      timer = setTimeout(measure, KEYBOARD_WAIT_MS);
    } else {
      measure();
    }
    return (): void => {
      hideSub.remove();
      if (timer) clearTimeout(timer);
      cancelMeasure();
    };
  }, [cancelMeasure, measure]);

  useEffect(() => {
    if (!ready || !isOpen) return;
    // A remount (forward, then back) is the same hold, not a new one.
    if (claimHoldHaptic(target.conversationId)) void haptics.longPress();
    progress.value = reduceMotion
      ? withTiming(1, { duration: 80 })
      : withTiming(1, { duration: ENTER_MS, easing: EASE_OUT });
  }, [isOpen, progress, ready, reduceMotion, target.conversationId]);

  // VoiceOver stays inside the menu and starts on its first item.
  useEffect(() => {
    if (!ready || !isOpen) return undefined;
    const timer = setTimeout(() => {
      const node = firstItemRef.current ? findNodeHandle(firstItemRef.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, FOCUS_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, [isOpen, ready]);

  useEffect(() => {
    if (isOpen) return;
    if (!ready || reduceMotion) {
      finishDismiss();
      return;
    }
    progress.value = withTiming(0, { duration: EXIT_MS, easing: EASE_OUT }, finished => {
      if (finished) runOnJS(finishDismiss)();
    });
  }, [finishDismiss, isOpen, progress, ready, reduceMotion]);

  useEffect(() => (): void => cancelAnimation(progress), [progress]);

  const menuActions = useMemo(() => orderHoldMenuActions(actions), [actions]);
  const layout = useMemo(
    () =>
      computeHoldLayout({
        windowHeight: overlaySize?.height ?? windowHeight,
        insetTop: insets.top,
        insetBottom: insets.bottom,
        rect,
        showRail: showReactionRail,
        menuRowCount: menuActions.length,
      }),
    [
      insets.bottom,
      insets.top,
      menuActions.length,
      overlaySize?.height,
      rect,
      showReactionRail,
      windowHeight,
    ],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * HOLD_BACKDROP_OPACITY,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * -layout.cardShift }],
  }));
  const railStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion
      ? []
      : [{ translateY: (1 - progress.value) * 10 }, { scale: 0.92 + 0.08 * progress.value }],
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion
      ? []
      : [{ translateY: (1 - progress.value) * -10 }, { scale: 0.96 + 0.04 * progress.value }],
  }));

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setOverlaySize(prev =>
      prev?.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const blockWidth = (overlaySize?.width ?? windowWidth) - HOLD_SIDE_INSET * 2;
  const firstIsRail = showReactionRail;

  return (
    // A separate window on iOS, so the menu sits above the composer dock and
    // the headers that carry their own z-index. Its origin is the window's.
    <FullWindowOverlay disableFullWindowOverlay={false}>
      <View
        ref={rootRef}
        collapsable={false}
        style={[StyleSheet.absoluteFill, ANDROID_LAYER_STYLE]}
        pointerEvents='box-none'
        accessibilityViewIsModal
        onAccessibilityEscape={onRequestClose}
        onLayout={handleLayout}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Close message actions'
          style={StyleSheet.absoluteFill}
          onPress={onRequestClose}
        />

        {ready ? (
          <>
            {rect && layout.cardHeight > 0 ? (
              <Animated.View
                pointerEvents='none'
                style={[
                  styles.card,
                  {
                    left: rect.x,
                    width: rect.width,
                    top: layout.cardTop,
                    height: layout.cardHeight,
                  },
                  cardStyle,
                ]}
              >
                <View className='bg-spaces-surface-raised' style={[styles.cardFill, SHADOW_TRAY]}>
                  <ConversationPaletteProvider>{source?.content}</ConversationPaletteProvider>
                </View>
              </Animated.View>
            ) : null}

            {showReactionRail ? (
              <Animated.View
                style={[
                  styles.block,
                  { left: HOLD_SIDE_INSET, width: blockWidth, top: layout.railTop },
                  railStyle,
                ]}
              >
                <View
                  className='flex-row items-center justify-between rounded-full bg-spaces-surface-raised'
                  style={[{ height: HOLD_RAIL_HEIGHT, padding: HOLD_RAIL_PADDING }, SHADOW_RAIL]}
                >
                  {QUICK_REACTIONS.map((emoji, index) => (
                    <Pressable
                      key={emoji}
                      ref={index === 0 ? firstItemRef : undefined}
                      accessibilityRole='button'
                      accessibilityLabel={`React ${emoji}`}
                      onPress={() => onReact(emoji)}
                      className='items-center justify-center rounded-full active:bg-spaces-surface'
                      style={styles.reaction}
                    >
                      <Text style={styles.emoji}>{emoji}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='More reactions'
                    onPress={onOpenEmojiPicker}
                    className='items-center justify-center rounded-full bg-spaces-surface'
                    style={styles.reaction}
                  >
                    <Plus size={HOLD_MENU_ICON_SIZE} color={foreground} />
                  </Pressable>
                </View>
              </Animated.View>
            ) : null}

            {menuActions.length > 0 ? (
              <Animated.View
                style={[
                  styles.block,
                  { left: HOLD_SIDE_INSET, width: blockWidth, top: layout.menuTop },
                  menuStyle,
                ]}
              >
                <View
                  className='overflow-hidden bg-spaces-surface-raised'
                  style={[
                    { height: layout.menuHeight, borderRadius: HOLD_MENU_RADIUS },
                    SHADOW_TRAY,
                  ]}
                >
                  <ScrollView
                    scrollEnabled={layout.menuScrolls}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.menuContent}
                  >
                    {menuActions.map((action, index) => (
                      <Pressable
                        key={action.id}
                        ref={!firstIsRail && index === 0 ? firstItemRef : undefined}
                        accessibilityRole='button'
                        accessibilityLabel={action.menuLabel}
                        onPress={action.onPress}
                        className='flex-row items-center active:bg-spaces-surface'
                        style={styles.menuRow}
                      >
                        <View style={styles.menuIcon}>{action.icon}</View>
                        <Text
                          className='text-[16px] leading-[22px] text-spaces-foreground'
                          style={
                            action.variant === 'destructive'
                              ? { color: HOLD_DESTRUCTIVE_COLOR }
                              : undefined
                          }
                          numberOfLines={1}
                        >
                          {action.menuLabel}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </View>
    </FullWindowOverlay>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  card: { position: 'absolute' },
  block: { position: 'absolute' },
  cardFill: { flex: 1, borderRadius: HOLD_MENU_RADIUS, overflow: 'hidden' },
  reaction: { width: HOLD_REACTION_SIZE, height: HOLD_REACTION_SIZE },
  emoji: { fontSize: HOLD_REACTION_EMOJI_SIZE },
  menuContent: { paddingVertical: HOLD_MENU_PADDING_Y },
  menuRow: {
    height: HOLD_MENU_ROW_HEIGHT,
    paddingHorizontal: HOLD_MENU_ROW_PADDING_X,
    columnGap: HOLD_MENU_ROW_GAP,
  },
  menuIcon: {
    width: HOLD_MENU_ICON_SIZE,
    height: HOLD_MENU_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
