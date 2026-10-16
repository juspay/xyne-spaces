// ---------------------------------------------------------------------------
// Recording utility helpers
// Ported from dashboard/src/utils/recordingUtils.ts
// ---------------------------------------------------------------------------

import { logger, Event } from '@/src/utils/logger';

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds as M:SS or H:MM:SS.
 */
export function formatRecordingDuration(ms: number | null): string {
  if (!ms) return 'N/A';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format elapsed milliseconds as MM:SS or H:MM:SS (always zero-padded).
 */
export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format a timestamp as "h:mma" (e.g. "3:45pm").
 */
export function formatTime12Hour(timestampMs: number): string {
  const date = new Date(timestampMs);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')}${ampm}`;
}

/**
 * Format a timestamp as a localized time string (e.g. "3:45 PM").
 */
export function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ---------------------------------------------------------------------------
// Title generation
// ---------------------------------------------------------------------------

/**
 * Generate a default recording title using the start time (or now).
 */
export function generateRecordingTitle(startTime: number | null): string {
  const now = startTime ? new Date(startTime) : new Date();
  return `Recording ${formatTime12Hour(now.getTime())}`;
}

// ---------------------------------------------------------------------------
// Speaker display helpers
// ---------------------------------------------------------------------------

const SPEAKER_COLORS = [
  '#3B82F6', // blue-500
  '#22C55E', // green-500
  '#A855F7', // purple-500
  '#F97316', // orange-500
  '#EC4899', // pink-500
  '#14B8A6', // teal-500
] as const;

/**
 * Deterministically pick a colour for a given speaker name.
 */
export function getSpeakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
}

/**
 * Get up-to-2-character initials from a display name.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

export function logRecordingError(context: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error(Event.RECORDING_ERROR, { context, error: errorMessage });
}
