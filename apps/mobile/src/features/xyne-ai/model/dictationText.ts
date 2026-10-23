export interface Transcript {
  committed: string;
  interim: string;
}

export const EMPTY_TRANSCRIPT: Transcript = { committed: '', interim: '' };

const joinWords = (before: string, after: string): string => {
  if (!before || !after) return before + after;
  return /\s$/.test(before) ? before + after : `${before} ${after}`;
};

// A final result closes an utterance and later results start a new one (Android, and iOS 18+
// after a pause). An empty final keeps the words already on screen.
export function applyResult(transcript: Transcript, text: string, isFinal: boolean): Transcript {
  const heard = text.trim();
  if (!isFinal) return { ...transcript, interim: heard };
  return { committed: joinWords(transcript.committed, heard || transcript.interim), interim: '' };
}

export const dictatedText = (base: string, { committed, interim }: Transcript): string =>
  joinWords(base, joinWords(committed, interim));
