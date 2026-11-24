import { useCallback, useId, useRef, useState, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { FullWindowOverlay } from '@/src/components/full-window-overlay';
import { Portal } from '@/src/components/primitives/portal';

import { useBarAnchorRect, type BarAnchor } from '../hooks/use-bar-anchor';
import { mentionsCardPlacement, type WindowRect } from '../model/mentions-card';

type MentionsCardLayerProps = {
  anchor: BarAnchor;
  /** The card, given the most height it may take. */
  children: (maxHeight: number) => ReactElement;
};

/**
 * Where the mentions card draws: above the typing bar, but outside it. The
 * composer dock clips to the bar's own height (and the thread card clips to
 * its corners), so a card inside the bar would be cut off, and on Android
 * would not get touches either. It draws in a full-window layer instead, with
 * its rect read from the bar's: on iOS a full-window overlay, which also sits
 * above the thread card's modal; on Android the app's root portal host, which
 * draws over every screen. Neither takes focus, so the keyboard stays up, and
 * the layer lets every touch outside the card through.
 */
export function MentionsCardLayer({ anchor, children }: MentionsCardLayerProps): ReactElement {
  const portalName = `mentions-card-${useId()}`;
  const bar = useBarAnchorRect(anchor);
  const keyboardHeight = useKeyboardState(state => state.height);
  const layerRef = useRef<View>(null);
  const [layer, setLayer] = useState<WindowRect | null>(null);

  const handleLayerLayout = useCallback((): void => {
    layerRef.current?.measureInWindow((x, y, width, height) => setLayer({ x, y, width, height }));
  }, []);

  const placement =
    bar !== null && layer !== null ? mentionsCardPlacement(bar, layer, keyboardHeight) : null;

  const content = (
    <View
      ref={layerRef}
      collapsable={false}
      pointerEvents='box-none'
      style={StyleSheet.absoluteFill}
      onLayout={handleLayerLayout}
    >
      {placement === null ? null : (
        <View
          pointerEvents='box-none'
          style={[
            styles.box,
            { left: placement.left, width: placement.width, height: placement.bottomEdge },
          ]}
        >
          {children(placement.maxHeight)}
        </View>
      )}
    </View>
  );

  if (Platform.OS === 'ios') {
    return <FullWindowOverlay disableFullWindowOverlay={false}>{content}</FullWindowOverlay>;
  }
  return <Portal name={portalName}>{content}</Portal>;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, justifyContent: 'flex-end' },
});
