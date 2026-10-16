import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  micErrorMessage,
  startUtterance,
  type Utterance,
  type UtteranceOptions,
} from './voiceCapture';

interface UseUtteranceOptions {
  onEnded: (text: string) => void;
  /** The stream failed (the user was already told). */
  onFailed?: () => void;
}

/** One utterance at a time for a mic button; releases the microphone on unmount. Start it from a click. */
export function useUtterance({ onEnded, onFailed }: UseUtteranceOptions): {
  isRecording: boolean;
  isTranscribing: boolean;
  start: (options?: UtteranceOptions) => void;
  stop: () => void;
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
    utterance.cancel();
    reset();
    return true;
  }, [reset]);

  useEffect(() => (): void => utteranceRef.current?.cancel(), []);

  return { isRecording, isTranscribing, start, stop, cancel };
}
