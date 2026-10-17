/**
 * Stacking levels for the app's overlapping surfaces.
 *
 * One list, so "what covers what" is a decision recorded in a single place
 * rather than a number guessed per component. React Native treats a sibling
 * that declares no `zIndex` as 0 the moment any other sibling declares one, so
 * anything that must float has to state its level — and the numbers only mean
 * anything relative to each other.
 *
 * `elevation` is the Android half of the same statement and should be set from
 * the same value.
 */
export const Z_INDEX = {
  /** Progressive blur band behind the tab bar. */
  chromeBackdrop: 1,
  /** The tab bar itself. */
  chrome: 2,
  /**
   * Floating action buttons and their dim.
   *
   * The classic FAB components each hardcode this value — `ROOT_Z_INDEX` in
   * the DM and channel list actions, `FAB_Z_INDEX` in the calls and activity
   * buttons. Left as they are; this entry records the level they occupy so
   * anything stacking against them has a name to use instead of a guess.
   */
  floatingAction: 1100,
  /**
   * Sheets, trays and anything modal.
   *
   * Above the FABs on purpose: a surface that takes over the screen covers the
   * shortcuts for the screen underneath it.
   */
  overlay: 2000,
} as const;
