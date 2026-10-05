import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { useUtterance } from '../../services/VoiceInput/useUtterance';
import { cn } from '../../utils/classNames';

interface ComposerVoiceButtonProps {
  onTranscript: (text: string) => void;
  onStateChange?: (state: { isRecording: boolean; isTranscribing: boolean }) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Textarea-compatible mic button for the /ai composer. Streams the same
 * PCM voice-input session as the sidebar's VoiceInput; the only difference is
 * that it hands the transcript back as plain text (via
 * onTranscript) instead of inserting TipTap mention nodes, since AIComposer
 * uses a plain <textarea>.
 */
export function ComposerVoiceButton({
  onTranscript,
  onStateChange,
  disabled = false,
  className,
}: ComposerVoiceButtonProps): ReactElement {
  const { isRecording, isTranscribing, start, stop } = useUtterance({
    onEnded: text => {
      if (text) onTranscript(text);
    },
  });

  // Mirror recording/transcribing state up to the composer (kept in a ref so an
  // inline onStateChange doesn't retrigger the effect every render).
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.({ isRecording, isTranscribing });
  }, [isRecording, isTranscribing]);

  const handleToggle = useCallback((): void => {
    if (isTranscribing || disabled) return;
    if (isRecording) {
      stop();
      return;
    }
    start();
  }, [isRecording, isTranscribing, disabled, stop, start]);

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
        className,
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
