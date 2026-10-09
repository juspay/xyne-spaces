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
export const neutral = {
  0: '#ffffff',
  50: '#f7f8fa',
  100: '#eef0f3',
  200: '#e2e5ea',
  500: '#555962',
  600: '#6b7280',
  800: '#1f222a',
  900: '#17171C',
  950: '#0b0c0f',
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
