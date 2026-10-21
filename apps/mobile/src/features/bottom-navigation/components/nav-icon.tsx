import { createElement, type ComponentType, type ReactElement } from 'react';
import type { SvgProps } from 'react-native-svg';

import { NAV_ICON_STROKE_WIDTH } from '../constants';

export type NavIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export type NavIcon = ComponentType<NavIconProps>;

type SvgIcon = ComponentType<SvgProps & { color?: string }>;

/**
 * Adapts a raw SVG into the icon shape the bar, the menu and the customize list
 * all use.
 *
 * `strokeWidth` is forwarded. It used to be accepted and then dropped, so every
 * call site's value was ignored and each icon drew at whatever weight its own
 * SVG defaulted to — which ranged from 1.27 to 2 across the set. Next to each
 * other in the pill that read as some icons being faded.
 */
export function navIcon(icon: SvgIcon): NavIcon {
  return function NavIconView({
    size = 24,
    color,
    strokeWidth = NAV_ICON_STROKE_WIDTH,
  }: NavIconProps): ReactElement {
    return createElement(icon, {
      width: size,
      height: size,
      strokeWidth,
      ...(color === undefined ? {} : { color }),
    });
  };
}
