/**
 * The "email participants" option is hidden above this many participants. Edit and delete use the
 * call's stored count (externals and organizer included), so they can hide it a bit before the
 * backend's internal-only cap of the same size applies.
 */
export const MAX_EMAIL_PARTICIPANTS = 100;
