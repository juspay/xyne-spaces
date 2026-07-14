/**
 * Utility function to play audio files
 */
import { logger, Event } from './logger';

// Singleton per sound path: a fresh Audio element per play leaks native
// listener registrations and media elements over long sessions.
const audioCache = new Map<string, HTMLAudioElement>();

export const playAudio = (audioPath: string, volume = 1): void => {
  try {
    let audio = audioCache.get(audioPath);
    if (!audio) {
      audio = new Audio(audioPath);
      audioCache.set(audioPath, audio);
    }
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.currentTime = 0;
    audio.play().catch((err: unknown) => {
      // Often benign (e.g. user hasn't interacted with the page yet) — log to
      // telemetry only (consoleLog=false) so it doesn't spam the console.
      logger.warn(
        Event.FRONTEND_ERROR,
        { context: 'playAudio.play', audioPath, message: String(err) },
        false,
      );
    });
  } catch (err) {
    logger.warn(
      Event.FRONTEND_ERROR,
      { context: 'playAudio.create', audioPath, message: String(err) },
      false,
    );
  }
};

/**
 * Audio file paths
 */
export const AUDIO_PATHS = {
  CALL_JOIN: '/sounds/Call_Click.wav',
  CALL_EXIT: '/sounds/Call_Exit_1.wav',
  PARTICIPANT_JOIN: '/sounds/Call_Join_1.wav',
  AFK_WARNING: '/sounds/notification.wav',
} as const;
