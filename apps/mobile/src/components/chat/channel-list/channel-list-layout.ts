import { StyleSheet } from 'react-native';

/**
 * Geometry shared by the channel rows, the group headers and the floating
 * action button.
 *
 * These are all load-bearing alignments — a group header borrows the channel
 * row's gutter and icon box, so its folder / star / hash glyph lands in the
 * same column as the rows' Hash / Lock glyphs and its title on the same column
 * as their names. The starred quick-jump lines up with the FAB it springs from.
 * Deriving them from one place keeps those columns true when any single value
 * is tuned.
 */

/** Left gutter of a channel row and of a group header (`px-3`). */
export const CHANNEL_ROW_GUTTER = 12;

/** Square that holds a row's Hash / Lock icon. */
export const CHANNEL_ICON_SIZE = 30;

/** The Hash / Lock glyph drawn inside that square. */
export const CHANNEL_ICON_GLYPH_SIZE = 18;

/** Height of a group header row. Taller than a channel row so each group reads
 *  as a band rather than as another row in the list. */
export const SECTION_HEADER_HEIGHT = 56;

/** Weight of the rules that open and close a group. */
export const SECTION_DIVIDER_WIDTH = StyleSheet.hairlineWidth;

export const FAB_SIZE = 48;
export const FAB_RIGHT = 24;
export const FAB_RADIUS = 14;

// Lives in `ui/fab-layout` now that the calls and activity buttons share it
// too. Re-exported so this module's existing importers are untouched.
export { useFabBottomOffset, useFabScreenBottomOffset } from '@/src/components/ui/fab-layout';

/**
 * Drop shadow / elevation of the floating action button, shared by the
 * channels and DMs tabs so both buttons read as the same control.
 */
export const FAB_SHADOW = {
  elevation: 6,
  shadowColor: '#000',
  shadowOpacity: 0.22,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
} as const;

/** Long-press hold before the starred fan / quick jump opens. */
export const FAB_LONG_PRESS_DELAY = 260;
