import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceInputService } from '../../../services/VoiceInput/voiceInputService';
import type { VoiceLevelStore } from './levelStore';

export type HoldState = 'idle' | 'requesting' | 'listening' | 'transcribing';

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];
/** Shorter than this is a tap, not speech, and nothing is sent. */
const MIN_HOLD_MS = 300;
/** A stuck button stops recording after this long. */
const MAX_HOLD_MS = 30_000;
const METER_INTERVAL_MS = 50;

export interface HoldToTalk {
  state: HoldState;
  /** Starts recording. */
  press: () => void;
  /** Stops recording and transcribes what was said. */
  release: () => void;
  /** Stops without transcribing. */
  cancel: () => void;
}

/**
 * Press and hold to talk: the microphone records only while held, so background noise between
 * commands is never heard. On release the recording is transcribed once and handed to `onText`.
 */
export function useHoldToTalk({
  levelStore,
  onText,
  onProblem,
  onTrace,
}: {
  levelStore: VoiceLevelStore;
  onText: (text: string) => void;
  /** Something the user should hear about: no microphone, a tap too short, nothing heard. */
  onProblem: (message: string) => void;
  /** What happened and how long it took, for the Diagnose log. */
  onTrace: (step: string, detail: string) => void;
}): HoldToTalk {
  const [state, setState] = useState<HoldState>('idle');
  const stateRef = useRef<HoldState>('idle');
  const attemptRef = useRef(0);
  const releasedEarlyRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<number[]>([]);
  const callbacksRef = useRef({ onText, onProblem, onTrace });
  useEffect(() => {
    callbacksRef.current = { onText, onProblem, onTrace };
  }, [onText, onProblem, onTrace]);

  const moveTo = useCallback((next: HoldState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Frees the microphone and the meter. */
  const releaseDevices = useCallback((): void => {
    timersRef.current.forEach(timer => window.clearInterval(timer));
    timersRef.current = [];
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    levelStore.set(0);
  }, [levelStore]);

  const cancel = useCallback((): void => {
    attemptRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state === 'recording') recorder.stop();
    releaseDevices();
    moveTo('idle');
  }, [moveTo, releaseDevices]);

  const release = useCallback((): void => {
    if (stateRef.current === 'requesting') releasedEarlyRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const startMeter = useCallback(
    (stream: MediaStream): void => {
      try {
        const context = new AudioContext();
        audioContextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          levelStore.set(Math.min(1, Math.sqrt(sum / samples.length) * 8));
        }, METER_INTERVAL_MS);
        timersRef.current.push(tick);
      } catch {
        // The orb just stays still; recording does not depend on the meter.
      }
    },
    [levelStore],
  );

  const transcribe = useCallback(
    async (audio: Blob, attempt: number): Promise<void> => {
      moveTo('transcribing');
      const startedAt = performance.now();
      try {
        const { text } = await voiceInputService.transcribeAudio({
          audioBlob: audio,
          mimeType: audio.type,
        });
        if (attempt !== attemptRef.current) return;
        callbacksRef.current.onTrace(
          'Transcribed',
          `${Math.round(performance.now() - startedAt)} ms · “${text.trim()}”`,
        );
        moveTo('idle');
        if (text.trim()) callbacksRef.current.onText(text.trim());
        else callbacksRef.current.onProblem('I didn’t catch that. Hold the orb and try again.');
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        callbacksRef.current.onTrace(
          'Transcription failed',
          `${Math.round(performance.now() - startedAt)} ms · ${error instanceof Error ? error.message : String(error)}`,
        );
        moveTo('idle');
        callbacksRef.current.onProblem('I couldn’t hear that. Please try again.');
      }
    },
    [moveTo],
  );

  const press = useCallback((): void => {
    if (stateRef.current !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      callbacksRef.current.onProblem('This browser can’t record audio.');
      return;
    }
    const attempt = ++attemptRef.current;
    releasedEarlyRef.current = false;
    moveTo('requesting');
    const pressedAt = performance.now();

    void navigator.mediaDevices.getUserMedia({ audio: true }).then(
      stream => {
        if (attempt !== attemptRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (releasedEarlyRef.current) {
          releaseDevices();
          moveTo('idle');
          callbacksRef.current.onProblem('Hold the orb while you talk.');
          return;
        }
        const mimeType = PREFERRED_TYPES.find(type => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks: Blob[] = [];
        const startedAt = Date.now();
        recorder.ondataavailable = (event): void => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = (): void => {
          releaseDevices();
          if (attempt !== attemptRef.current) return;
          recorderRef.current = null;
          const audio = new Blob(chunks, { type: recorder.mimeType });
          callbacksRef.current.onTrace(
            'Recorded',
            `${((Date.now() - startedAt) / 1000).toFixed(1)} s · ${Math.round(audio.size / 1024)} KB · ${recorder.mimeType}`,
          );
          if (Date.now() - startedAt < MIN_HOLD_MS) {
            moveTo('idle');
            callbacksRef.current.onProblem('Hold the orb while you talk.');
            return;
          }
          void transcribe(audio, attempt);
        };
        recorderRef.current = recorder;
        recorder.start();
        callbacksRef.current.onTrace(
          'Microphone on',
          `${Math.round(performance.now() - pressedAt)} ms after pressing`,
        );
        moveTo('listening');
        startMeter(stream);
        timersRef.current.push(window.setTimeout(release, MAX_HOLD_MS));
      },
      (error: unknown) => {
        if (attempt !== attemptRef.current) return;
        moveTo('idle');
        const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
        callbacksRef.current.onTrace(
          'Microphone failed',
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        );
        callbacksRef.current.onProblem(
          blocked
            ? 'Microphone access is blocked. Allow it in the browser to talk.'
            : 'The microphone isn’t available.',
        );
      },
    );
  }, [moveTo, release, releaseDevices, startMeter, transcribe]);

  useEffect(() => cancel, [cancel]);

  return { state, press, release, cancel };
}
