/**
 * Recording utility functions
 * Common time formatting and display helpers for recording screens
 */

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
