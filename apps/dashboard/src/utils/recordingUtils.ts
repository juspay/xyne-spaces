/**
 * Recording utility functions
 * Common time formatting and display helpers for recording screens
 */

import { normalizeTagName, TAG_FORMAT_REGEX } from '@xyne/shared';
import { logger, Event } from './logger';

/**
 * Format duration in milliseconds to MM:SS or HH:MM:SS format
 * Used for recording duration display
 * @param ms - Duration in milliseconds or null
 * @returns Formatted string like "00:19", "12:34", or "01:12:34"
 */
export const formatRecordingDuration = (ms: number | null): string => {
  if (!ms) return 'N/A';
  return formatElapsedTime(ms);
};

/**
 * Format elapsed time for recording timer (HH:MM:SS or MM:SS)
 * Used for live recording timer display
 * @param ms - Elapsed time in milliseconds
 * @returns Formatted string like "01:23:45" or "12:34"
 */
export const formatElapsedTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Calculate active recording time, excluding completed and ongoing pauses.
 */
export const calculateRecordingElapsedMs = (
  startTime: number | null,
  pauseStartedAt: number | null,
  accumulatedPausedMs: number,
  now = Date.now(),
): number => {
  if (!startTime) return 0;

  const effectiveEndTime = pauseStartedAt ?? now;
  return Math.max(0, effectiveEndTime - startTime - accumulatedPausedMs);
};

/**
 * Format timestamp to 12-hour time with AM/PM
 * Used for transcript timestamps
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted string like "2:30pm"
 */
export const formatTime12Hour = (timestamp: number): string => {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
};

/**
 * Format timestamp to time string (hour:minute AM/PM)
 * Used for transcript message timestamps
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted string like "2:30 PM"
 */
export const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Generate auto title for recording based on start time
 * Format: "Recording 2:30pm"
 * @param startTime - Recording start timestamp or null
 * @returns Auto-generated title string
 */
export const generateRecordingTitle = (startTime: number | null): string => {
  const now = startTime ? new Date(startTime) : new Date();
  return `Recording ${formatTime12Hour(now.getTime())}`;
};

export const DEFAULT_RECORDING_TITLE = 'Impromptu Recording';
export const NO_TRANSCRIPT_RECORDING_TITLE = 'Recording (no transcript)';

/** Trims a recording's title, falling back to `DEFAULT_RECORDING_TITLE` when blank. */
export const resolveRecordingTitle = (title: string | null | undefined): string =>
  title?.trim() || DEFAULT_RECORDING_TITLE;

/** How long a recording gets to produce a transcript before we say it has none. */
export const NO_TRANSCRIPT_AFTER_MS = 5 * 60 * 1000;

export interface RecordingTitleInput {
  title: string | null;
  isEnded: boolean;
  endedAtMs: number | null;
  hasTranscript: boolean;
  hasSummary: boolean;
}

export type RecordingTitleState =
  | { kind: 'named'; text: string }
  | { kind: 'generating' }
  | { kind: 'fallback'; text: string };

export const getRecordingTitleState = (
  recording: RecordingTitleInput,
  now = Date.now(),
): RecordingTitleState => {
  const title = recording.title?.trim();
  if (title) return { kind: 'named', text: title };

  const { endedAtMs } = recording;
  if (!recording.isEnded || !endedAtMs) {
    return { kind: 'fallback', text: DEFAULT_RECORDING_TITLE };
  }

  const sinceEndedMs = now - endedAtMs;

  if (recording.hasTranscript && !recording.hasSummary) {
    return { kind: 'generating' };
  }
  if (!recording.hasTranscript && sinceEndedMs >= NO_TRANSCRIPT_AFTER_MS) {
    return { kind: 'fallback', text: NO_TRANSCRIPT_RECORDING_TITLE };
  }
  return { kind: 'fallback', text: DEFAULT_RECORDING_TITLE };
};

export const isRecordingTitleStateTimed = (
  recording: RecordingTitleInput,
  now = Date.now(),
): boolean => {
  if (recording.title?.trim()) return false;
  if (!recording.isEnded || !recording.endedAtMs) return false;

  return now - recording.endedAtMs < NO_TRANSCRIPT_AFTER_MS;
};

/**
 * Speaker color classes for transcript display
 */
const SPEAKER_COLORS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-green-100 text-green-700 border-green-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-orange-100 text-orange-700 border-orange-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-teal-100 text-teal-700 border-teal-200',
] as const;

/**
 * Get consistent color class for a speaker name
 * @param name - Speaker name
 * @returns Tailwind color classes string
 */
export const getSpeakerColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
};

/**
 * Trims labels and drops blanks and duplicates, preserving order.
 */
export const normalizeRecordingTags = (tags: string[]): string[] => {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
};

/**
 * Reads `calls.recordingParticipants` (stringified JSON string[]) into user ids,
 * prepending the creator so older rows still resolve to at least one person.
 */
export const getRecordingParticipantIds = (
  createdByUserId: string | undefined,
  stored: string | null | undefined,
): string[] => {
  let ids: string[] = [];
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      ids = [];
    }
  }
  if (createdByUserId && !ids.includes(createdByUserId)) return [createdByUserId, ...ids];
  return ids;
};

/** Canonical tag name, or null when the text can't make one — tags must start with a letter. */
export const slugifyRecordingLabel = (raw: string): string | null => {
  const slug = normalizeTagName(raw);
  if (!slug) return null;
  const safe = /^[a-z]/.test(slug) ? slug : `l-${slug}`;
  return TAG_FORMAT_REGEX.test(safe) ? safe : null;
};

/**
 * Get initials from a name (up to 2 characters)
 * @param name - Full name
 * @returns Initials like "JD"
 */
export const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

/**
 * Log recording error with proper event tracking
 * @param context - Context where error occurred
 * @param error - Error object or message
 */
export const logRecordingError = (context: string, error: unknown): void => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error(Event.RECORDING_ERROR, {
    context,
    error: errorMessage,
  });
};

/** Recording share post details. */
export interface RecordingSharePost {
  channelId: string;
  conversationId: string;
  messageId: string;
}

export const isRecordingTicketLinkShare = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>)['intent'] === 'ticket_link';
};

/** Reads post details from share metadata. */
export const getRecordingSharePost = (metadata: unknown): RecordingSharePost | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const { channelId, conversationId, messageId } = metadata as Record<string, unknown>;
  return typeof channelId === 'string' &&
    typeof conversationId === 'string' &&
    typeof messageId === 'string'
    ? { channelId, conversationId, messageId }
    : null;
};

/**
 * STT model labels for display
 */
export const STT_MODEL_LABELS: Record<string, string> = {
  google: 'Google',
  azure: 'Azure',
  deepgram: 'Deepgram',
};

/**
 * Available STT models
 */
export const STT_MODELS = ['google', 'azure', 'deepgram'] as const;

export type SttModel = (typeof STT_MODELS)[number];

/**
 * Pull a recording's two document ids out of `Call.metadata`.
 *
 * Neither has a column of its own: the note-taker webhook stamps `notesCanvasId`
 * (older rows carry `notesCanvasViewAccessId` instead) and the summary pipeline
 * stamps `detailedSummaryCanvasId`. Both are absent for recordings created before
 * those canvases existed, so every caller must handle nulls.
 */
export const readRecordingCanvasIds = (
  metadata: unknown,
): { summaryCanvasId: string | null; notesCanvasId: string | null } => {
  const meta = (metadata ?? null) as Record<string, unknown> | null;
  const rawSummary = meta?.['detailedSummaryCanvasId'];
  const rawNotes = meta?.['notesCanvasId'] ?? meta?.['notesCanvasViewAccessId'];
  return {
    summaryCanvasId: typeof rawSummary === 'string' && rawSummary ? rawSummary : null,
    notesCanvasId: typeof rawNotes === 'string' && rawNotes ? rawNotes : null,
  };
};
