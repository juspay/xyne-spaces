import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Mic } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { ComposerVoiceButton } from '../../AIScreen/ComposerVoiceButton';

// The Web Speech API is not in TypeScript's DOM lib; just the parts used here.
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResult };
}
interface SpeechRecognitionErrorEvent {
  readonly error: string;
}
interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// Errors that mean the browser's recogniser cannot work here at all (e.g. Electron's Chromium
// has no speech service): switch to the backend transcription instead.
const UNUSABLE = new Set(['network', 'service-not-allowed', 'language-not-supported']);

interface NavigatorMicButtonProps {
  /** Words so far, while speaking. */
  onInterim: (text: string) => void;
  /** The finished sentence. */
  onTranscript: (text: string) => void;
  onListeningChange: (listening: boolean) => void;
  disabled?: boolean;
}

/**
 * Mic for the navigator. Uses the browser's own speech recognition when it has one (Chrome,
 * Edge, Safari): no backend setup, and words appear as they are spoken. Otherwise, or when the
 * browser's recogniser turns out not to work, the backend transcription (ComposerVoiceButton),
 * which needs the python-agent STT provider configured.
 */
export function NavigatorMicButton({
  onInterim,
  onTranscript,
  onListeningChange,
  disabled = false,
}: NavigatorMicButtonProps): ReactElement {
  const [useBrowser, setUseBrowser] = useState(() => getSpeechRecognition() !== null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    onListeningChange(listening);
  }, [listening, onListeningChange]);

  useEffect(
    () => (): void => {
      recognitionRef.current?.abort();
    },
    [],
  );

  const toggle = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setUseBrowser(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalText = '';
    recognition.onresult = (event): void => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) finalText += result[0]?.transcript ?? '';
        else interim += result[0]?.transcript ?? '';
      }
      onInterim(`${finalText}${interim}`.trim());
    };
    recognition.onerror = (event): void => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (UNUSABLE.has(event.error)) {
        setUseBrowser(false);
        toast.error('Browser speech recognition is unavailable here', {
          description: 'Switched to server transcription; press the mic again.',
        });
        return;
      }
      toast.error('Voice input failed', {
        description:
          event.error === 'not-allowed'
            ? 'Microphone access is blocked for this site.'
            : event.error,
      });
    };
    recognition.onend = (): void => {
      recognitionRef.current = null;
      setListening(false);
      const text = finalText.trim();
      if (text) onTranscript(text);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [onInterim, onTranscript]);

  if (!useBrowser) {
    return (
      <ComposerVoiceButton
        disabled={disabled}
        onStateChange={({ isRecording, isTranscribing }) =>
          onListeningChange(isRecording || isTranscribing)
        }
        onTranscript={onTranscript}
      />
    );
  }

  return (
    <button
      type='button'
      onClick={toggle}
      disabled={disabled}
      aria-label={listening ? 'Stop voice input' : 'Speak where to go'}
      title={listening ? 'Stop listening' : 'Speak'}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
        listening
          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      data-track-category='Assistant'
      data-track-name={listening ? 'NAVIGATOR_STOP_VOICE' : 'NAVIGATOR_START_VOICE'}
    >
      <Mic className='h-4 w-4' aria-hidden strokeWidth={1.75} />
    </button>
  );
}
