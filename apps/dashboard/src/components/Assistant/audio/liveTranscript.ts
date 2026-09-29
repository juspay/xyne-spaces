import type { VoiceStreamSession } from '../../../services/VoiceInput/voiceInputService';

/** Once the audio ends, the last words are due within this long. */
export const LAST_WORDS_MS = 3_000;

/**
 * Speech-to-text that listens while the user talks, so the words are ready moments after they
 * stop, rather than after the whole recording is uploaded and read.
 */
export interface LiveTranscript {
  /** Sends the next piece of the recording, in order. */
  send: (chunk: Blob) => void;
  /** Ends the audio. Resolves with what was heard, or null when it could not be heard live. */
  finish: () => Promise<string | null>;
  /** Stops listening and drops anything still on its way. */
  close: () => void;
}

export function liveTranscript(session: VoiceStreamSession): LiveTranscript {
  const heard: string[] = [];
  /** Words heard since the last settled phrase, which the next message may still change. */
  let unsettled = '';
  let failed = false;
  let closed = false;
  let onClosed = (): void => undefined;

  session.onMessage(message => {
    if (message.type === 'error') failed = true;
    if (!message.text) return;
    if (message.type === 'partial') unsettled = message.text;
    if (message.type === 'final') {
      heard.push(message.text);
      unsettled = '';
    }
  });
  session.onError(() => {
    failed = true;
  });
  session.onClose(() => {
    closed = true;
    onClosed();
  });

  return {
    send: chunk => session.sendChunk(chunk),
    finish: () =>
      new Promise(resolve => {
        // Closed before the audio ended: part of it was never heard.
        if (failed || closed) {
          resolve(null);
          return;
        }
        const late = setTimeout(() => {
          resolve(null);
          session.close();
        }, LAST_WORDS_MS);
        onClosed = (): void => {
          clearTimeout(late);
          resolve(failed ? null : [...heard, unsettled].join(' ').replace(/\s+/g, ' ').trim());
        };
        session.endAudio();
      }),
    close: () => session.close(),
  };
}
