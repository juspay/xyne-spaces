/**
 * Module-level singleton refs used to signal that the currently selected activity
 * was manually marked as unread. Panels that call bulk mark-as-read mutators on
 * unmount should check the relevant ref and skip if true.
 *
 * Two separate refs prevent cross-consumption: when switching channels, both the
 * thread panel and channel panel unmount. Each checks only its own ref so neither
 * interferes with the other.
 *
 * Each ref is consumed (reset to false) by the first unmount that checks it.
 */
export const activitySkipMarkAsReadThreadRef = { current: false };
export const activitySkipMarkAsReadChannelRef = { current: false };
