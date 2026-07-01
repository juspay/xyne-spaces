import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { voiceInputService } from '../../services/VoiceInput/voiceInputService';
import { cn } from '../../utils/classNames';

interface ComposerVoiceButtonProps {
  /** Called with the transcribed text once recording stops and STT returns. */
  onTranscript: (text: string) => void;
  /** Notifies the parent whenever recording/transcribing state changes, so the
   *  composer can render the "Listening…" UI + animated border while active. */
  onStateChange?: (state: { isRecording: boolean; isTranscribing: boolean }) => void;
  disabled?: boolean;
}

/**
 * Textarea-compatible mic button for the /ai composer. Reuses the same
 * `voiceInputService.transcribeAudio` backend as the sidebar's VoiceInput; the
 * only difference is that it hands the transcript back as plain text (via
 * onTranscript) instead of inserting TipTap mention nodes, since AIComposer
 * uses a plain <textarea>.
 */
export function ComposerVoiceButton({
  onTranscript,
  onStateChange,
  disabled = false,
}: ComposerVoiceButtonProps): ReactElement {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Mirror recording/transcribing state up to the composer (kept in a ref so an
  // inline onStateChange doesn't retrigger the effect every render).
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.({ isRecording, isTranscribing });
  }, [isRecording, isTranscribing]);

  const stopStream = useCallback((): void => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(
    async (blob: Blob): Promise<void> => {
      setIsTranscribing(true);
      try {
        const transcript = await voiceInputService.transcribeAudio({ audioBlob: blob });
        const text = transcript.text.trim();
        if (text) onTranscript(text);
      } catch (err) {
        toast.error('Voice transcription failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setIsTranscribing(false);
      }
    },
    [onTranscript],
  );

  const stopRecording = useCallback((): void => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') recorder.stop();
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Voice recording is not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        chunksRef.current = [];
        recorderRef.current = null;
        stopStream();
        void transcribe(blob);
      };
      recorder.onerror = () => {
        setIsRecording(false);
        stopStream();
        toast.error('Voice recording failed unexpectedly');
      };

      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      const isDenied = err instanceof DOMException && err.name === 'NotAllowedError';
      stopStream();
      toast.error(isDenied ? 'Microphone permission denied' : 'Failed to start voice recording');
    }
  }, [stopStream, transcribe]);

  const handleToggle = useCallback((): void => {
    if (isTranscribing || disabled) return;
    if (isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  }, [isRecording, isTranscribing, disabled, stopRecording, startRecording]);

  // Release the microphone on unmount.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stopStream();
    };
  }, [stopStream]);

  return (
    <button
      type='button'
      onClick={handleToggle}
      disabled={disabled || isTranscribing}
      aria-label={isRecording ? 'Stop voice input' : 'Start voice input'}
      title={isTranscribing ? 'Transcribing…' : isRecording ? 'Stop voice input' : 'Voice input'}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
        isRecording
          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        (disabled || isTranscribing) && 'cursor-not-allowed opacity-60',
      )}
      data-track-category='XyneAI'
      data-track-name={isRecording ? 'STOP_VOICE_INPUT' : 'START_VOICE_INPUT'}
    >
      {isTranscribing ? (
        <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
      ) : (
        <Mic className='h-4 w-4' aria-hidden strokeWidth={1.75} />
      )}
    </button>
  );
}
