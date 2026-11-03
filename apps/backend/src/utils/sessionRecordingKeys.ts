/**
 * Session Recording Key Utilities
 *
 * Generates Redis keys for session recording storage.
 * Format: session-recording:{userId}:{sessionId}
 *
 * The key is scoped by the authenticated user so two users posting the same
 * sessionId can never share (or poison) one list.
 *
 * Example: session-recording:user_123:sess-abc-123
 */

const PREFIX = 'session-recording:';

/**
 * Build a Redis key for session recording storage.
 * @param userId - The authenticated user who owns the recording
 * @param sessionId - The session ID
 * @returns The Redis key string
 */
export function buildSessionRecordingKey(userId: string, sessionId: string): string {
  return `${PREFIX}${userId}:${sessionId}`;
}

/**
 * Extract user ID and session ID from a Redis key.
 * @param key - The Redis key string (e.g., 'session-recording:user_123:sess-abc-123')
 * @returns The ids, or null if the key is not in the expected format
 */
export function parseSessionRecordingKey(key: string): { userId: string; sessionId: string } | null {
  if (!key.startsWith(PREFIX)) {
    return null;
  }
  const rest = key.slice(PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) {
    return null;
  }
  const userId = rest.slice(0, sep);
  const sessionId = rest.slice(sep + 1);
  return sessionId ? { userId, sessionId } : null;
}

/**
 * Global Redis set key that tracks all session recording keys.
 * Allows retrieving all session recording keys via SMEMBERS without scanning.
 */
export const SESSION_RECORDING_KEYS_SET = 'session-recording:keys';
