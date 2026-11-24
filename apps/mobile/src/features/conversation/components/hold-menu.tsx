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
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { scheduleOnRN } from 'react-native-worklets';

import { useLatestRef } from '@/src/components/input-composer/utils/use-latest-ref';
import type { MessageActionsViewProps } from '@/src/features/chat/v2/components/message-actions-sheet';
import { QUICK_REACTIONS } from '@/src/features/chat/v2/components/message-actions-sheet';
import { haptics } from '@/src/utils/haptics';

import {
  HOLD_ANDROID_Z_INDEX,
  HOLD_CARD_SHADOW,
  HOLD_ENTER_OFFSET,
  HOLD_FOCUS_SETTLE_MS,
  HOLD_MENU_ENTER_SCALE,
  HOLD_MENU_ICON_SIZE,
  HOLD_MENU_PADDING,
  HOLD_MENU_ROW_GAP,
  HOLD_MENU_ROW_HEIGHT,
  HOLD_MENU_ROW_PADDING_X,
  HOLD_MENU_ROW_RADIUS,
  HOLD_MORE_ICON_SIZE,
  HOLD_MORE_SIZE,
  HOLD_RADIUS,
  HOLD_RAIL_ENTER_SCALE,
  HOLD_RAIL_HEIGHT,
  HOLD_RAIL_PADDING,
  HOLD_REACTION_EMOJI_SIZE,
  HOLD_REACTION_SIZE,
  HOLD_REDUCED_MOTION_MS,
  HOLD_SIDE_INSET,
  TRAY_SHADOW,
} from '../constants';
import { computeHoldLayout, orderHoldMenuActions, type HoldRect } from '../model/hold-menu';
import { claimHoldHaptic, clearHoldSource, getHoldSource } from '../model/hold-source-store';
import { colorOf } from '../model/token-color';
import { ConversationOverlayLayer, type AndroidOverlayLayer } from './conversation-overlay-layer';
import { ConversationPaletteProvider } from './conversation-palette';

const ENTER_MS = 200;
const EXIT_MS = 140;
const EASE_OUT = Easing.out(Easing.cubic);
/** Longest the first measure waits for the keyboard to finish hiding. */
const KEYBOARD_WAIT_MS = 600;
/** Moves focus to the first item once the enter animation has laid things out. */
const FOCUS_DELAY_MS = ENTER_MS + HOLD_FOCUS_SETTLE_MS;
/** Without a separate window the root has to out-stack the screen's headers and composer. */
const ANDROID_LAYER_STYLE =
  Platform.OS === 'android'
    ? ({ zIndex: HOLD_ANDROID_Z_INDEX, elevation: HOLD_ANDROID_Z_INDEX } as const)
    : undefined;

type HoldMenuProps = MessageActionsViewProps & {
  /** Android: a modal inside the thread card, whose clipping would cut off the menu. */
  android?: AndroidOverlayLayer;
};

/**
 * The redesigned message hold: the held message is lifted as a card in place
 * (the screen behind stays undimmed; tapping it closes), a reaction rail sits
 * above it and the actions below.
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
  android = 'inline',
}: HoldMenuProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [overlaySize, setOverlaySize] = useState<{ width: number; height: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const danger = colorOf(useCSSVariable('--color-status-danger'));

  const rootRef = useRef<View>(null);
  const [rect, setRect] = useState<HoldRect | null>(null);
  const [ready, setReady] = useState(false);
  const [source] = useState(() => getHoldSource(target.message.messageId));
  const firstItemRef = useRef<View>(null);
  const measureToken = useRef(0);

  const progress = useSharedValue(0);
  const dismissedRef = useRef(false);
  const onDismissedRef = useLatestRef(onDismissed);
  const finishDismiss = useCallback((): void => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearHoldSource();
    onDismissedRef.current();
  }, [onDismissedRef]);

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
    if (claimHoldHaptic(target.message.messageId)) void haptics.longPress();
    progress.set(
      reduceMotion
        ? withTiming(1, { duration: HOLD_REDUCED_MOTION_MS })
        : withTiming(1, { duration: ENTER_MS, easing: EASE_OUT }),
    );
  }, [isOpen, progress, ready, reduceMotion, target.message.messageId]);

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
    progress.set(
      withTiming(0, { duration: EXIT_MS, easing: EASE_OUT }, finished => {
        if (finished) scheduleOnRN(finishDismiss);
      }),
    );
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

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.get()) * -layout.cardShift }],
  }));
  const railStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: reduceMotion
        ? []
        : [
            { translateY: (1 - p) * HOLD_ENTER_OFFSET },
            { scale: HOLD_RAIL_ENTER_SCALE + (1 - HOLD_RAIL_ENTER_SCALE) * p },
          ],
    };
  });
  const menuStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: reduceMotion
        ? []
        : [
            { translateY: (1 - p) * -HOLD_ENTER_OFFSET },
            { scale: HOLD_MENU_ENTER_SCALE + (1 - HOLD_MENU_ENTER_SCALE) * p },
          ],
    };
  });

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setOverlaySize(prev =>
      prev?.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const blockWidth = (overlaySize?.width ?? windowWidth) - HOLD_SIDE_INSET * 2;
  const firstIsRail = showReactionRail;

  return (
    <ConversationOverlayLayer android={android} onRequestClose={onRequestClose}>
      <View
        ref={rootRef}
        collapsable={false}
        style={[StyleSheet.absoluteFill, ANDROID_LAYER_STYLE]}
        pointerEvents='box-none'
        accessibilityViewIsModal
        onAccessibilityEscape={onRequestClose}
        onLayout={handleLayout}
      >
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
                {/* The shadow sits outside the clip, which would otherwise cut it off on iOS. */}
                <View className='bg-spaces-surface-raised' style={styles.cardShadow}>
                  <View style={styles.cardFill}>
                    <ConversationPaletteProvider raised>
                      {source?.content}
                    </ConversationPaletteProvider>
                  </View>
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
                  className='flex-row items-center justify-between bg-spaces-surface-raised'
                  style={styles.rail}
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
                  <View className='items-center justify-center' style={styles.reaction}>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel='More reactions'
                      onPress={onOpenEmojiPicker}
                      className='items-center justify-center rounded-full bg-spaces-surface'
                      style={styles.more}
                    >
                      <Plus size={HOLD_MORE_ICON_SIZE} color={foreground} />
                    </Pressable>
                  </View>
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
                  className='bg-spaces-surface-raised'
                  style={[styles.menuShadow, { height: layout.menuHeight }]}
                >
                  <View className='flex-1 overflow-hidden' style={styles.menuClip}>
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
                            style={action.variant === 'destructive' ? { color: danger } : undefined}
                            numberOfLines={1}
                          >
                            {action.menuLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </View>
    </ConversationOverlayLayer>
  );
}

/** The hold menu for the thread card. */
export function ThreadCardHoldMenu(props: MessageActionsViewProps): ReactElement {
  return <HoldMenu {...props} android='modal' />;
}

const styles = StyleSheet.create({
  card: { position: 'absolute' },
  block: { position: 'absolute' },
  cardShadow: { flex: 1, borderRadius: HOLD_RADIUS, boxShadow: HOLD_CARD_SHADOW },
  cardFill: { flex: 1, borderRadius: HOLD_RADIUS, overflow: 'hidden' },
  rail: {
    height: HOLD_RAIL_HEIGHT,
    padding: HOLD_RAIL_PADDING,
    borderRadius: HOLD_RADIUS,
    ...TRAY_SHADOW,
  },
  reaction: { width: HOLD_REACTION_SIZE, height: HOLD_REACTION_SIZE },
  more: { width: HOLD_MORE_SIZE, height: HOLD_MORE_SIZE },
  emoji: { fontSize: HOLD_REACTION_EMOJI_SIZE },
  menuShadow: { borderRadius: HOLD_RADIUS, ...TRAY_SHADOW },
  menuClip: { borderRadius: HOLD_RADIUS },
  menuContent: { padding: HOLD_MENU_PADDING },
  menuRow: {
    height: HOLD_MENU_ROW_HEIGHT,
    paddingHorizontal: HOLD_MENU_ROW_PADDING_X,
    borderRadius: HOLD_MENU_ROW_RADIUS,
    columnGap: HOLD_MENU_ROW_GAP,
  },
  menuIcon: {
    width: HOLD_MENU_ICON_SIZE,
    height: HOLD_MENU_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
