/**
 * Utility function to play audio files
 */
// Singleton per sound path: a fresh Audio element per play leaks native
// listener registrations and media elements over long sessions.
const audioCache = new Map<string, HTMLAudioElement>();

export const playAudio = (audioPath: string): void => {
  try {
    let audio = audioCache.get(audioPath);
    if (!audio) {
      audio = new Audio(audioPath);
      audioCache.set(audioPath, audio);
    }
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Silently handle audio play failures (e.g., user hasn't interacted with the page yet)
    });
  } catch {
    // Silently handle audio creation failures
  }
};

/**
 * Audio file paths
 */
export const AUDIO_PATHS = {
  CALL_JOIN: '/sounds/Call_Click.wav',
  CALL_EXIT: '/sounds/Call_Exit_1.wav',
  PARTICIPANT_JOIN: '/sounds/Call_Join_1.wav',
} as const;
