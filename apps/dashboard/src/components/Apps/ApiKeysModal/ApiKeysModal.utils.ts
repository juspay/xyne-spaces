/** Formatters for the API keys modal. */

/** A key's creation or expiry date, in the viewer's locale. */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Whole days until a key expires, floored at zero.
 *
 * Rounds up, so a key with any time left today reads as "1d left" rather than
 * "0d left" while it is still usable.
 */
export function daysLeft(value: string): number {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}
