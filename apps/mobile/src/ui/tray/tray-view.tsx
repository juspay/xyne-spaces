import { type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { VIEW_FADE } from './constants';
import { useTrayInternals } from './tray-context';

export type TrayViewProps = {
  /** Unique id, matching what `setView` / `Trigger` ask for. */
  id: string;
  /**
   * Pinned below the body, outside the crossfade.
   *
   * A sibling of the body rather than a child, so "Apply" or "Create section"
   * holds still while the content above it changes. Inside the body, every view
   * transition would shift the button.
   */
  footer?: ReactNode;
  /** Hides the footer for this view without unmounting it, so height animates. */
  hideFooter?: boolean;
  children: ReactNode;
};

/**
 * One view in the tray.
 *
 * It does not measure itself. `Tray.Content` measures the whole stack in one
 * place, so a view can add a header or a footer without anyone having to
 * remember to include it in a sum — the mistake that clipped the footer when
 * the grab strip was left out of one.
 */
export function TrayView({
  id,
  footer,
  hideFooter = false,
  children,
}: TrayViewProps): ReactElement | null {
  const { view } = useTrayInternals();
  const isActive = view === id;

  const bodyStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isActive ? 1 : 0, VIEW_FADE),
    // Incoming views scale up into place; outgoing ones simply fade.
    transform: [{ scale: withTiming(isActive ? 1 : 0.96, VIEW_FADE) }],
  }));

  return (
    <View
      // Inactive views stay mounted for the crossfade — the incoming one has to
      // be measurable before the outgoing one unmounts, or the sheet collapses
      // to zero and springs back — but must not be reachable by touch or by a
      // screen reader.
      pointerEvents={isActive ? 'auto' : 'none'}
      importantForAccessibility={isActive ? 'yes' : 'no-hide-descendants'}
      style={isActive ? styles.active : styles.inactive}
    >
      <Animated.View style={bodyStyle}>{children}</Animated.View>
      {footer === undefined ? null : (
        <View style={hideFooter ? styles.hidden : undefined}>{footer}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  active: {
    position: 'relative',
  },
  // Absolute so an inactive view contributes no height while it fades out.
  inactive: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  hidden: {
    height: 0,
    overflow: 'hidden',
  },
});
