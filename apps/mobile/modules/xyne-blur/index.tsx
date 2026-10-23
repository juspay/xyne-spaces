import { type ReactElement, type Ref } from 'react';
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
  /**
   * `glass` is liquid glass where the device can draw it ({@link isGlassSupported})
   * and the frost everywhere else.
   */
  material?: BlurMaterial;
  /**
   * Fades the surface in from its top edge, reaching full strength this far
   * down. 0 or unset for none.
   */
  fadeHeight?: number;
  /** Corner radius of the shape the surface is clipped to. Glass bends light along it. */
  cornerRadius?: number;
  ref?: Ref<unknown>;
};

export type BlurMaterial = 'frost' | 'glass';

/**
 * Whether `material='glass'` draws glass here: Android 13 (API 33) for its
 * runtime shaders, iOS 26 for the system's Liquid Glass.
 */
export const isGlassSupported =
  Platform.OS === 'android'
    ? Platform.Version >= 33
    : Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

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
