/**
 * Raw color scales for the Spaces design.
 *
 * The only file in the app allowed to hold a color literal. Roles are
 * written in terms of these, so re-palleting is a change here rather
 * than a sweep through every role.
 *
 * Stops are numbered on the usual 0-950 ramp and added as the design
 * needs them, so a later addition slots in without renumbering what
 * exists.
 */
/**
 * A true grey ramp: every stop has equal red, green and blue.
 *
 * The previous one carried 3-21 points more blue than red at each stop,
 * which is why dark surfaces read as faintly navy rather than black. These
 * are the same stops with the hue taken out — each one keeps the perceived
 * lightness (CIE L*) it already had, so nothing in the UI shifts in weight,
 * only in cast. `900` is the bar's `#181818`, which the whole ramp is now
 * anchored to.
 */
export const neutral = {
  0: '#ffffff',
  50: '#f8f8f8',
  100: '#f2f2f2',
  200: '#e5e5e5',
  300: '#cfcfcf',
  400: '#9b9b9b',
  500: '#727272',
  600: '#595959',
  700: '#3c3c3c',
  800: '#222222',
  900: '#181819',
  950: '#0c0c0c',
} as const;

/** Kept for palettes that want a blue accent; the default theme uses coral. */
export const blue = {
  500: '#2f7cf6',
  600: '#1d6ae5',
} as const;

/** The default theme's accent: unread badges, the compose button. */
export const coral = {
  500: '#F0716A',
} as const;
