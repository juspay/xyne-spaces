import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { Tray as MorphletTray, type TrayContentProps as MorphletContentProps } from 'morphlet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCSSVariable } from 'uniwind';

import { OVERLAY_BORDER_WIDTH, useOverlayBorderColor } from '../overlay-border';
import {
  TRAY_BOTTOM_OFFSET,
  TRAY_CORNER_RADIUS,
  TRAY_HORIZONTAL_INSET,
  TRAY_TOP_INSET,
} from './constants';

export type TrayContentProps = MorphletContentProps;

/**
 * Morphlet's card, painted in the app's surface.
 *
 * Everything else — the spring, the keyboard avoidance, the edge-hugging
 * squircle, the drag to dismiss — is the library's own and is passed straight
 * through. This only supplies what the library cannot know: the theme.
 */
export function TrayContent({
  backgroundColor,
  horizontalInset = TRAY_HORIZONTAL_INSET,
  bottomOffset = TRAY_BOTTOM_OFFSET,
  topInset = TRAY_TOP_INSET,
  // The library fades the card as it is dragged down. Here it stays fully
  // visible until it has gone; a caller can still opt back in.
  fadeOnDrag = false,
  children,
  ...rest
}: TrayContentProps): ReactElement {
  const surface = useCSSVariable('--color-spaces-background') as string;
  const borderColor = useOverlayBorderColor();

  return (
    <MorphletTray.Content
      backgroundColor={backgroundColor ?? surface}
      horizontalInset={horizontalInset}
      bottomOffset={bottomOffset}
      topInset={topInset}
      fadeOnDrag={fadeOnDrag}
      cornerRadius={TRAY_CORNER_RADIUS}
      {...rest}
    >
      {/*
        Also the card's edge. The border cannot go on `Tray.Content`'s own
        style: Morphlet lifts `borderRadius` out of it for the native card and
        leaves the container square, so a border there is a rectangle that the
        card's rounded clip then cuts off at the corners. This wrapper fills the
        card exactly, so rounding it to the same radius draws the edge where
        the clip is.

        A root of its own. Morphlet presents the card in a native modal, a
        separate view hierarchy from the app's — the same situation as React
        Native's `Modal`, which gesture handler requires its own root view for.
        Without one, no gesture handler inside the tray ever activates: a
        `GestureDetector` here looks fine and never fires.
      */}
      <GestureHandlerRootView style={[styles.root, { borderColor }]}>
        {children}
      </GestureHandlerRootView>
    </MorphletTray.Content>
  );
}

const styles = StyleSheet.create({
  // Shrinks with the card's ceiling like the sections it wraps, rather than
  // pushing the footer past it.
  root: {
    flexShrink: 1,
    minHeight: 0,
    borderWidth: OVERLAY_BORDER_WIDTH,
    borderRadius: TRAY_CORNER_RADIUS,
    borderCurve: 'continuous',
  },
});
