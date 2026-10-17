import { type ReactElement } from 'react';
import { Platform, processColor, View, type ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

export type BlurSurfaceProps = Omit<ViewProps, 'children'> & {
  /** The screen's background. Android draws it under the blurred content. */
  baseColor: string;
  /** The surface's own colour, laid over the blur. */
  tintColor: string;
  /** Opacity of `tintColor`, 0–1. */
  tintAlpha: number;
  /** The app's theme, which the iOS material follows instead of the system's. */
  colorScheme: 'light' | 'dark';
};

type NativeSurfaceProps = Omit<BlurSurfaceProps, 'baseColor' | 'tintColor'> & {
  baseColor: unknown;
  tintColor: unknown;
};

const NativeSurface = requireNativeView<NativeSurfaceProps>('XyneBlur', 'XyneBlurSurfaceView');

/** Android only: iOS blurs whatever is behind a surface, so it needs no target. */
const NativeTarget =
  Platform.OS === 'android' ? requireNativeView<ViewProps>('XyneBlur', 'XyneBlurTargetView') : null;

/**
 * Android takes colours as ARGB integers so it does not need API 26's colour
 * objects; iOS takes the string and parses it into a `UIColor` itself.
 */
function toNativeColor(color: string): unknown {
  return Platform.OS === 'android' ? processColor(color) : color;
}

/**
 * A frosted background for a header or a bar. Childless — lay it under the
 * content with `StyleSheet.absoluteFill`.
 */
export function BlurSurface({ baseColor, tintColor, ...rest }: BlurSurfaceProps): ReactElement {
  return (
    <NativeSurface
      pointerEvents='none'
      {...rest}
      baseColor={toNativeColor(baseColor)}
      tintColor={toNativeColor(tintColor)}
    />
  );
}

/**
 * Wraps the content blur surfaces show through. On Android it records its
 * children for the surfaces to draw; on iOS it is a plain view.
 *
 * A surface must not sit inside the target it blurs.
 */
export function BlurTarget(props: ViewProps): ReactElement {
  return NativeTarget ? <NativeTarget collapsable={false} {...props} /> : <View {...props} />;
}
