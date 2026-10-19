import { Easing } from 'react-native-reanimated';

import { Z_INDEX } from '../z-index';

/** Drag distance past which a release dismisses, rather than springing back. */
export const CLOSE_THRESHOLD = 110;
/** A flick dismisses below the distance threshold if it is fast enough. */
export const FLICK_VELOCITY = 800;

export const TRAY_RADIUS = 28;
/** Height of the grab strip above a view's content. */
export const TRAY_GRAB_HEIGHT = 20;
/** Tallest the sheet may grow, as a share of the screen. The body scrolls past it. */
export const TRAY_MAX_HEIGHT_RATIO = 0.86;
export const TRAY_SIDE_MARGIN = 10;
/** Clear space between the tray and the bottom edge, above the safe-area inset. */
export const TRAY_BOTTOM_LIFT = 10;

/**
 * One spring drives translate, height, overlay and scale together, which is
 * what makes the open read as a single growth rather than four animations.
 */
export const TRAY_SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;
/** Height changes follow content; softer, so a tall view does not overshoot. */
export const HEIGHT_SPRING = { damping: 30, stiffness: 220, mass: 1 } as const;

/** Crossfade between views. Must finish before the height spring settles. */
export const VIEW_FADE = { duration: 160, easing: Easing.out(Easing.quad) } as const;

/** How far past the top edge a drag can pull before resistance takes over. */
export const RUBBER_BAND_LIMIT = 64;

/** Above the FABs: a sheet that takes over the screen covers them too. */
export const TRAY_Z_INDEX = Z_INDEX.overlay;
