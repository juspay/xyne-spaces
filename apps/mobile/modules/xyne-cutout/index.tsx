import { type ReactElement } from 'react';
import { type ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

/** A rounded rect, in the view's own coordinates; a circle when `radius` is half its side. */
export type CutoutHole = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

export type CutoutViewProps = ViewProps & {
  /** Rounded rects to cut away. May overlap: overlapping holes read as one. */
  holes: readonly CutoutHole[];
};

const NativeCutout = requireNativeView<CutoutViewProps>('XyneCutout', 'XyneCutoutView');

/**
 * Cuts holes out of its children, so whatever is truly behind the view shows
 * through them.
 *
 * Drawn on the GPU as the children draw — the children go into a layer the
 * size of the view and the holes are cleared out of it — so there is no
 * bitmap, no mask element and nothing to redo when a hole moves. With no holes
 * it is a plain view and costs nothing more.
 */
export function CutoutView(props: CutoutViewProps): ReactElement {
  return <NativeCutout collapsable={false} {...props} />;
}
