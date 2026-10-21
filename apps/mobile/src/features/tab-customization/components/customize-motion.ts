import { Easing } from 'react-native-reanimated';

/** Long enough not to fire on a scroll flick, short enough to feel immediate. */
export const DRAG_ACTIVATION_MS = 180;

/** Rows settle into their new slot; nothing here should overshoot into a neighbour. */
export const ROW_SPRING = { damping: 26, stiffness: 320, mass: 0.7 } as const;
/** Shape and fill changes, which must land faster than the row travels. */
export const ROW_MORPH = { duration: 140, easing: Easing.out(Easing.quad) } as const;

/** Pixels per frame the list creeps when a drag reaches its edge. */
export const AUTO_SCROLL_SPEED = 8;
/** Band at the top and bottom of the viewport that triggers the creep. */
export const AUTO_SCROLL_EDGE = 72;
