import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Dimensions, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { GlassView } from 'expo-glass-effect';
import { ChevronDown } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import type { ChatKeyboardGeometry } from '@/src/features/chat/v2/chatKeyboardConfig';
import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';
import { haptics } from '@/src/utils/haptics';

const SCROLL_TO_BOTTOM_SIZE = 32;

const styles = StyleSheet.create({
  scrollToBottomGlass: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: SCROLL_TO_BOTTOM_SIZE / 2,
  },
});

const SCROLL_TO_BOTTOM_BUTTON_GAP = 12;
/** Slack for rounding when checking that the dock sits on the screen bottom. */
const DOCK_BOTTOM_TOLERANCE_PX = 2;
/** Android TextInput ignores ancestor opacity and clip; park it off any screen. */
const COMPOSER_HOLD_OFFSCREEN_TRANSLATE = 8192;
/** Let sticky/keyboard motion settle before measuring the dock in development. */
const DOCK_PLACEMENT_CHECK_DELAY_MS = 600;

export type ChatComposerScrollToBottomButtonProps = {
  composerHeight: SharedValue<number>;
  enabled: boolean;
  onPress: () => void;
  visible: boolean;
};

export function ChatComposerScrollToBottomButton({
  composerHeight,
  enabled,
  onPress,
  visible,
}: ChatComposerScrollToBottomButtonProps): ReactElement | null {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const { theme } = useUniwind();
  const animatedOffsetStyle = useAnimatedStyle(
    () => ({ bottom: composerHeight.value + SCROLL_TO_BOTTOM_BUTTON_GAP }),
    [composerHeight],
  );

  if (!enabled || !visible) return null;

  return (
    <Animated.View
      pointerEvents='box-none'
      style={[
        {
          position: 'absolute',
          right: 16,
          width: 32,
          height: 32,
        },
        animatedOffsetStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={(): void => {
          void haptics.buttonTap();
        }}
        accessibilityRole='button'
        accessibilityLabel='Scroll to bottom'
        className={
          SUPPORTS_LIQUID_GLASS
            ? 'flex-1 items-center justify-center rounded-full'
            : 'flex-1 items-center justify-center rounded-full bg-muted'
        }
      >
        {/* Sits above the message list, so on iOS 26 there is real content
            behind it for the glass to refract. */}
        {SUPPORTS_LIQUID_GLASS ? (
          <GlassView
            glassEffectStyle='regular'
            colorScheme={theme === 'dark' ? 'dark' : 'light'}
            style={styles.scrollToBottomGlass}
          />
        ) : null}
        <ChevronDown size={16} color={foregroundColor} />
      </Pressable>
    </Animated.View>
  );
}

export type ChatComposerDockProps = {
  children: ReactNode;
  composerHeight: SharedValue<number>;
  /**
   * Temporary open hold: keep the dock at full height (list inset stays put)
   * but do not paint the input until shimmer is gone. Permanent hide belongs
   * to join / read-only hosts that swap `children`.
   */
  disabled?: boolean;
  keyboardGeometry: ChatKeyboardGeometry;
  onComposerHeight: (height: number) => void;
  onComposerLayout: (event: LayoutChangeEvent) => void;
  onShellReady?: () => void;
  shellReadyKey?: string;
  scrollToBottomSlot?: ReactNode;
};

export function ChatComposerDock({
  children,
  composerHeight,
  disabled = false,
  keyboardGeometry,
  onComposerHeight,
  onComposerLayout,
  onShellReady,
  shellReadyKey,
  scrollToBottomSlot,
}: ChatComposerDockProps): ReactElement {
  const shellRef = useRef<View>(null);
  const composerContentRef = useRef<View>(null);
  const shellReadyRef = useRef(false);
  const shellReadyKeyRef = useRef(shellReadyKey);
  const didVerifyPlacementRef = useRef(false);
  const keyboardIsVisible = useKeyboardState(state => state.isVisible);
  const chatScreenColor = useCSSVariable('--color-chat-screen') as string | undefined;

  const markShellReady = useCallback(
    (expectedShellReadyKey: string | undefined): void => {
      if (shellReadyKeyRef.current !== expectedShellReadyKey) return;
      if (shellReadyRef.current) return;
      shellReadyRef.current = true;
      onShellReady?.();
    },
    [onShellReady],
  );

  const measureShellForIdentity = useCallback(
    (expectedShellReadyKey: string | undefined): (() => void) | undefined => {
      const composerContent = composerContentRef.current;
      if (!composerContent) {
        markShellReady(expectedShellReadyKey);
        return undefined;
      }

      composerContent.measure((_x, _y, _width, height) => {
        if (shellReadyKeyRef.current !== expectedShellReadyKey) return;
        if (Number.isFinite(height) && height > 0) onComposerHeight(height);
        markShellReady(expectedShellReadyKey);
      });

      // Fabric can skip the measure callback for a node that is between native
      // attachments. The existing SharedValue floor/measurement remains valid;
      // release the readiness gate on the next layout frame so an open cannot
      // stall forever waiting for a callback that never arrives.
      const fallbackFrame = requestAnimationFrame(() => {
        if (shellReadyKeyRef.current !== expectedShellReadyKey) return;
        markShellReady(expectedShellReadyKey);
      });
      return (): void => cancelAnimationFrame(fallbackFrame);
    },
    [markShellReady, onComposerHeight],
  );

  useLayoutEffect(() => {
    if (shellReadyKeyRef.current === shellReadyKey) return;
    shellReadyKeyRef.current = shellReadyKey;
    shellReadyRef.current = false;
    didVerifyPlacementRef.current = false;
    return measureShellForIdentity(shellReadyKey);
  }, [measureShellForIdentity, shellReadyKey]);

  // `bottom: 0` resolves against the dock's parent, not the window. A host that
  // sizes that parent short (a bottom-consuming SafeAreaView, a padded tab
  // container) leaves the composer floating with no visible error. Surface that
  // in development instead of shipping a silently misplaced composer. Measured
  // once per open, after sticky/keyboard motion has settled, so a transition is
  // never mistaken for a mis-sized parent.
  useEffect(() => {
    if (!__DEV__ || didVerifyPlacementRef.current) return;
    const timer = setTimeout(() => {
      const shell = shellRef.current;
      if (!shell || KeyboardController.isVisible()) return;
      didVerifyPlacementRef.current = true;
      shell.measureInWindow((_x, y, _width, height) => {
        const gap = Dimensions.get('window').height - (y + height);
        if (gap <= DOCK_BOTTOM_TOLERANCE_PX) return;
        // This is a development-only host contract diagnostic; keep it visible
        // in Metro without promoting it to production telemetry.
        // eslint-disable-next-line no-console
        console.warn(
          `[ChatComposerDock] Composer sits ${Math.round(gap)}px above the screen bottom. ` +
            'Its parent is shorter than the window — check for a bottom-consuming ' +
            'SafeAreaView or a padded container around this chat surface.',
        );
      });
    }, DOCK_PLACEMENT_CHECK_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, [shellReadyKey]);

  const handleComposerLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      onComposerLayout(event);
      markShellReady(shellReadyKeyRef.current);
    },
    [markShellReady, onComposerLayout],
  );

  const animatedComposerStyle = useAnimatedStyle(
    () => ({ height: composerHeight.value }),
    [composerHeight],
  );

  return (
    <KeyboardStickyView
      // The keyboard animation shared value can retain a stale translation when
      // Android resumes a notification/deep-link route with the IME hidden.
      // Disabling the sticky view makes its closed position authoritative until
      // the next real keyboard-show event, keeping the dock anchored at bottom: 0.
      enabled={keyboardIsVisible}
      offset={keyboardGeometry.stickyOffset}
      pointerEvents={disabled ? 'none' : 'box-none'}
      style={{
        // KeyboardStickyView owns per-frame keyboard motion; the list reserves
        // this dock through contentInsetEndAdjustment instead of normal flow.
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        // While the input is held, paint the reserved slot so list shimmer
        // cannot show through the transparent sticky view.
        backgroundColor: disabled && chatScreenColor ? chatScreenColor : 'transparent',
      }}
    >
      {scrollToBottomSlot}
      <Animated.View
        ref={shellRef}
        pointerEvents={disabled ? 'none' : 'auto'}
        accessibilityElementsHidden={disabled}
        importantForAccessibility={disabled ? 'no-hide-descendants' : 'auto'}
        style={[{ justifyContent: 'flex-end', overflow: 'hidden' }, animatedComposerStyle]}
      >
        <View
          ref={composerContentRef}
          collapsable={false}
          pointerEvents={disabled ? 'none' : 'auto'}
          onLayout={handleComposerLayout}
          style={
            disabled
              ? {
                  opacity: 0,
                  transform: [
                    { translateX: COMPOSER_HOLD_OFFSCREEN_TRANSLATE },
                    { translateY: COMPOSER_HOLD_OFFSCREEN_TRANSLATE },
                  ],
                }
              : undefined
          }
        >
          {children}
        </View>
        {disabled ? (
          <View
            pointerEvents='none'
            className='bg-chat-screen'
            style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
          />
        ) : null}
      </Animated.View>
    </KeyboardStickyView>
  );
}
