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
  900: '#15171c',
  950: '#0b0c0f',
} as const;
