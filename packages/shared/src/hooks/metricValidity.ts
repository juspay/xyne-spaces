/**
 * Tracks events that invalidate client-side latency measurements:
 * - App going to background (visibilitychange)
 * - Zero WebSocket connection state changes (reconnects)
 *
 * A measurement is considered skewed if:
 * 1. Any interruption event occurred during the measurement window, OR
 * 2. The document is currently hidden, OR
 * 3. The Zero connection is in a non-connected state
 *
 * Skewed metrics are excluded from OTel histograms but still logged
 * with a `skewed` field for debugging.
 */

type InterruptionReason = 'visibility_hidden' | 'zero_connection_change';

interface InterruptionEvent {
  timestamp: number;
  reason: InterruptionReason;
}

const events: InterruptionEvent[] = [];
const MAX_EVENTS = 500;

let connectionConnected = false;

function recordEvent(reason: InterruptionReason): void {
  events.push({ timestamp: performance.now(), reason });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

let initialized = false;

function ensureInitialized(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      recordEvent('visibility_hidden');
    }
  });
}

/**
 * Call when Zero connection state changes to a non-connected state
 * (disconnected, connecting, error, etc.).
 */
export function recordConnectionChange(): void {
  ensureInitialized();
  connectionConnected = false;
  recordEvent('zero_connection_change');
}

/**
 * Call when Zero connection state becomes 'connected'.
 */
export function recordConnectionConnected(): void {
  ensureInitialized();
  connectionConnected = true;
}

/**
 * Check whether a measurement between startTime and endTime is skewed.
 * Returns true if:
 * - Any interruption event occurred during the window
 * - The document is currently hidden
 * - The Zero connection is not in 'connected' state
 */
export function wasInterrupted(
  startTime: number,
  endTime: number = performance.now(),
): boolean {
  ensureInitialized();

  if (typeof document !== 'undefined' && document.hidden) {
    return true;
  }

  if (!connectionConnected) {
    return true;
  }

  return events.some(e => e.timestamp >= startTime && e.timestamp <= endTime);
}
