/**
 * Session Recording Key Utilities
 *
 * Generates Redis keys for session recording storage.
 * Format: session-recording:{sessionId}
 *
 * Example: session-recording:sess-abc-123
 */

/**
 * Build a Redis key for session recording storage.
 * @param sessionId - The session ID
 * @returns The Redis key string
 */
export function buildSessionRecordingKey(sessionId: string): string {
  return `session-recording:${sessionId}`;
}

/**
 * Extract session ID from a Redis key.
 * @param key - The Redis key string (e.g., 'session-recording:sess-abc-123')
 * @returns The session ID, or null if invalid
 */
export function parseSessionRecordingKey(key: string): string | null {
  if (!key.startsWith('session-recording:')) {
    return null;
  }
  const sessionId = key.slice('session-recording:'.length);
  return sessionId || null;
}

/**
 * Global Redis set key that tracks all session recording keys.
 * Allows retrieving all session recording keys via SMEMBERS without scanning.
 */
export const SESSION_RECORDING_KEYS_SET = 'session-recording:keys';
