/**
 * Utility function to play audio files
 */
export const playAudio = (audioPath: string): void => {
  try {
    const audio = new Audio(audioPath);
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
