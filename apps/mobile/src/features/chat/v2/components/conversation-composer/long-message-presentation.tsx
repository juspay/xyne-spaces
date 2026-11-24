import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactElement } from 'react';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { ChatPaintCollapseModel } from '@/src/features/chat/v2/paint/chatPaint.types';
import { withAlpha } from '@/src/utils/color';

type CollapsedFadeSpec = {
  /** The row's background, which the last collapsed lines fade into. */
  color: string;
  height: number;
};

/**
 * How a screen with its own layout folds long messages, on both the paint and
 * the rich body. Omitted, the paint row's collapse and the chat "Read more" apply.
 */
export type LongMessagePresentation = {
  /** Replaces the paint row's collapse decision. */
  collapse: ChatPaintCollapseModel;
  readMoreTextStyle: TextStyle;
  fade?: CollapsedFadeSpec | undefined;
};

/**
 * "Read more" with a gradient standing on it, over the bottom of the
 * collapsed text, for bodies the link directly follows. Without a fade it is
 * the link alone.
 */
export function ReadMoreWithFade({
  fade,
  children,
}: {
  fade: CollapsedFadeSpec | undefined;
  children: ReactElement;
}): ReactElement {
  if (!fade) return children;
  return (
    <View>
      <CollapsedFade spec={fade} edge={styles.aboveEdge} />
      {children}
    </View>
  );
}

/**
 * The body with the gradient over its own last lines while `collapsed`, for
 * bodies that something other than the link follows. Without a fade it is the
 * body alone.
 */
export function FadedBody({
  fade,
  collapsed,
  children,
}: {
  fade: CollapsedFadeSpec | undefined;
  collapsed: boolean;
  children: ReactElement;
}): ReactElement {
  if (!fade) return children;
  return (
    <View>
      {children}
      {collapsed ? <CollapsedFade spec={fade} edge={styles.bottomEdge} /> : null}
    </View>
  );
}

function CollapsedFade({
  spec: { color, height },
  edge,
}: {
  spec: CollapsedFadeSpec;
  edge: ViewStyle;
}): ReactElement {
  const colors = useMemo(() => [withAlpha(color, 0), color] as const, [color]);
  const style = useMemo(() => [styles.fade, edge, { height }], [edge, height]);
  return <LinearGradient pointerEvents='none' colors={colors} style={style} />;
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0 },
  aboveEdge: { bottom: '100%' },
  bottomEdge: { bottom: 0 },
});
