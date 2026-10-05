import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  micErrorMessage,
  startUtterance,
  type Utterance,
  type UtteranceOptions,
} from './voiceCapture';

interface UseUtteranceOptions {
  /** The final transcript, once the stream has closed and the hook is idle again. */
  onEnded: (text: string) => void;
  /** The stream failed (the user was already told); the hook is idle again. */
  onFailed?: () => void;
}

/**
 * One utterance at a time for a mic button: owns the utterance, the recording/transcribing
 * state and the toasts, and releases the microphone on unmount. Start it from a click.
 */
export function useUtterance({ onEnded, onFailed }: UseUtteranceOptions): {
  isRecording: boolean;
  isTranscribing: boolean;
  start: (options?: UtteranceOptions) => void;
  /** Stops recording and waits for the final transcript, which goes to `onEnded`. */
  stop: () => void;
  /** Drops the utterance without a transcript; false when there was none. */
  cancel: () => boolean;
} {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const utteranceRef = useRef<Utterance | null>(null);
  const handlersRef = useRef({ onEnded, onFailed });
  useEffect(() => {
    handlersRef.current = { onEnded, onFailed };
  });

  const reset = useCallback((): void => {
    utteranceRef.current = null;
    setIsRecording(false);
    setIsTranscribing(false);
  }, []);

  const start = useCallback(
    (options?: UtteranceOptions): void => {
      if (utteranceRef.current) return;
      const utterance = startUtterance(options);
      utteranceRef.current = utterance;
      utterance.ready.then(
        () => setIsRecording(true),
        (error: unknown) => {
          reset();
          toast.error(micErrorMessage(error));
        },
      );
      utterance.ended.then(
        text => {
          reset();
          handlersRef.current.onEnded(text);
        },
        (error: Error) => {
          reset();
          toast.error('Voice transcription failed', { description: error.message });
          handlersRef.current.onFailed?.();
        },
      );
    },
    [reset],
  );

  const stop = useCallback((): void => {
    // The server sends the final transcript and closes; `ended` then hands it over.
    utteranceRef.current?.stop();
    setIsRecording(false);
    setIsTranscribing(true);
  }, []);

  const cancel = useCallback((): boolean => {
    const utterance = utteranceRef.current;
    if (!utterance) return false;
    // A cancelled utterance reports nothing.
    utterance.cancel();
    reset();
    return true;
  }, [reset]);

  // Release the microphone and drop the stream on unmount.
  useEffect(() => (): void => utteranceRef.current?.cancel(), []);

  return { isRecording, isTranscribing, start, stop, cancel };
}
