import type { ThreadCardSource } from './thread-card-motion';

/**
 * Where the thing that opened the thread card sat on screen (the "N replies"
 * strip, an Activity row, a parked bubble), so the card can grow out of it and
 * shrink back into it. One slot: the opener sets it as it is tapped, and the
 * card reads it as it opens.
 *
 * It is not cleared on read (a double render must read the same frame); it
 * goes stale instead, so a thread opened some other way a moment later does
 * not grow out of an old strip.
 */
let pending: { rect: ThreadCardSource; at: number } | null = null;

export function setThreadCardSource(rect: ThreadCardSource, now: number = Date.now()): void {
  pending = { rect, at: now };
}

/** The opener's frame if it was tapped within `maxAgeMs`; otherwise null. */
export function getThreadCardSource(
  maxAgeMs: number,
  now: number = Date.now(),
): ThreadCardSource | null {
  if (!pending || now - pending.at > maxAgeMs) return null;
  return pending.rect;
}

export function clearThreadCardSource(): void {
  pending = null;
}
