/**
 * Morphlet's own frame defaults, restated.
 *
 * The library does not export them, and `useTrayBodySpace` has to agree with
 * the ceiling the native sheet clamps to — a scroller sized from a different
 * number pushes the footer off the bottom. Passed explicitly by `Tray.Content`
 * rather than left to the default, so a library upgrade that changes one
 * cannot silently desynchronise the two.
 */
export const TRAY_CORNER_RADIUS = 32;
export const TRAY_TOP_INSET = 12;
export const TRAY_BOTTOM_OFFSET = 16;
export const TRAY_HORIZONTAL_INSET = 16;
