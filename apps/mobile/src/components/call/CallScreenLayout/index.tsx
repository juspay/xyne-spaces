/**
 * CallScreenLayout
 *
 * The layering of the call screen, independent of where its data comes from:
 *   stage (tiles) → header → connection banner → overlay → control bar → sheets (children).
 * It owns the safe-area maths and the show/hide animation of the chrome, and hands the stage the
 * space it may use (`StageInsets`) so tiles never sit under the header or the control bar.
 */
import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';

import { CallControls } from '../CallControls';
import { CallHeader } from '../CallHeader';
import { callColors, callLayout, callMotion } from '../callTheme';
import { getControlBarOffset, type StageInsets } from '../callStage.utils';

type HeaderProps = Omit<React.ComponentProps<typeof CallHeader>, 'topInset'>;
type ControlsProps = React.ComponentProps<typeof CallControls>;

interface CallScreenLayoutProps {
  /** Renders the stage; receives the space left between the header and the control bar. */
  renderStage: (insets: StageInsets) => React.ReactNode;
  /** Rendered under the header (connection banner). Gets the top safe-area inset. */
  renderBanner?: ((topInset: number) => React.ReactNode) | undefined;
  /** Rendered above the stage, e.g. the "waiting for others" card. */
  renderOverlay?: ((insets: StageInsets) => React.ReactNode) | undefined;
  header: HeaderProps;
  controls: ControlsProps;
  /** Header and control bar visible? (Immersive video hides them until tapped.) */
  chromeVisible: boolean;
  /** Any touch on the chrome — keeps it up and restarts the idle timer. */
  onChromeTouch?: (() => void) | undefined;
  /** Sheets and modals; rendered last so they sit above everything. */
  children?: React.ReactNode;
}

export function CallScreenLayout({
  renderStage,
  renderBanner,
  renderOverlay,
  header,
  controls,
  chromeVisible,
  onChromeTouch,
  children,
}: CallScreenLayoutProps): React.ReactElement {
  const insets = useRawSafeAreaInsets();
  const controlsBottomOffset = getControlBarOffset(insets.bottom);
  const stageInsets = useMemo<StageInsets>(
    () => ({
      top: insets.top + callLayout.headerHeight,
      bottom: controlsBottomOffset + callLayout.controlBarHeight + 10,
    }),
    [controlsBottomOffset, insets.top],
  );

  const progress = useSharedValue(1);
  useEffect(() => {
    progress.value = withTiming(chromeVisible ? 1 : 0, { duration: callMotion.chromeMs });
  }, [chromeVisible, progress]);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -28 }],
  }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 36 }],
  }));
  const chromePointerEvents = chromeVisible ? 'box-none' : 'none';

  return (
    <Animated.View style={styles.root} entering={FadeIn.duration(callMotion.chromeMs)}>
      {renderStage(stageInsets)}

      <Animated.View
        style={[styles.chromeLayer, styles.headerLayer, headerStyle]}
        pointerEvents={chromePointerEvents}
        onTouchStart={onChromeTouch}
      >
        <CallHeader {...header} topInset={insets.top} />
      </Animated.View>

      {renderBanner?.(insets.top)}
      {renderOverlay?.(stageInsets)}

      <Animated.View
        entering={FadeInDown.duration(320)}
        style={[styles.chromeLayer, { bottom: controlsBottomOffset }]}
        pointerEvents='box-none'
      >
        <Animated.View
          style={controlsStyle}
          pointerEvents={chromePointerEvents}
          onTouchStart={onChromeTouch}
        >
          <CallControls {...controls} />
        </Animated.View>
      </Animated.View>

      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: callColors.stage,
  },
  chromeLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  headerLayer: {
    top: 0,
  },
});
