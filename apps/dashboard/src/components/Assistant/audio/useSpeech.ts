import { useCallback, useEffect, useRef, useState } from 'react';
import { ttsService, type SynthesizedSpeech } from '../../../services/VoiceInput/ttsService';
import { flushRemainder, splitSentences } from '../../AIScreen/voice/voiceSentences';
import { getApiErrorMessage } from '../../../utils/apiError';
import { toSpeakable } from './speakable';

type Item = { text: string; audio?: Promise<SynthesizedSpeech | null> };

/** Sentences synthesized ahead of playback, so the next one is ready when this one ends. */
const PREFETCH = 2;

export interface Speech {
  speaking: boolean;
  /** Speaks a whole reply, replacing anything still playing. */
  speak: (text: string) => void;
  cancel: () => void;
}

/**
 * Spoken replies through `/api/tts`, sentence by sentence so the first one starts quickly.
 * When the server voice is unavailable, the browser's own voice reads the reply instead, so
 * replies are always heard; the reply is on screen as well.
 */
export function useSpeech({
  enabled,
  onTrace,
}: {
  enabled: boolean;
  /** Reports a switch to the browser voice, for the Diagnose log. */
  onTrace: (step: string, detail: string) => void;
}): Speech {
  const [speaking, setSpeaking] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  const tokenRef = useRef(0);
  const pumpingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endPlaybackRef = useRef<(() => void) | null>(null);
  const enabledRef = useRef(enabled);
  /** Once the server voice fails, the browser voice is used for the rest of the page. */
  const serverVoiceRef = useRef(true);
  const onTraceRef = useRef(onTrace);
  useEffect(() => {
    onTraceRef.current = onTrace;
  }, [onTrace]);

  const prefetch = useCallback((): void => {
    for (const item of itemsRef.current.slice(0, PREFETCH)) {
      if (!serverVoiceRef.current) {
        item.audio ??= Promise.resolve(null);
        continue;
      }
      item.audio ??= (async (): Promise<SynthesizedSpeech | null> => {
        const startedAt = performance.now();
        try {
          const audio = await ttsService.synthesize(item.text);
          onTraceRef.current(
            'Server voice ready',
            `${Math.round(performance.now() - startedAt)} ms`,
          );
          return audio;
        } catch (error) {
          if (serverVoiceRef.current) {
            serverVoiceRef.current = false;
            onTraceRef.current(
              'Server voice failed',
              `${Math.round(performance.now() - startedAt)} ms · ${getApiErrorMessage(error, 'unknown')} · using the browser voice`,
            );
          }
          return null;
        }
      })();
    }
  }, []);

  const play = useCallback(
    (audio: SynthesizedSpeech): Promise<void> =>
      new Promise<void>(resolve => {
        const element = new Audio(`data:${audio.mimeType};base64,${audio.audioBase64}`);
        audioRef.current = element;
        const done = (): void => {
          endPlaybackRef.current = null;
          audioRef.current = null;
          resolve();
        };
        endPlaybackRef.current = done;
        element.onended = done;
        element.onerror = done;
        void element.play().catch(done);
      }),
    [],
  );

  const pump = useCallback(async (): Promise<void> => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const token = tokenRef.current;
    setSpeaking(true);
    try {
      while (itemsRef.current.length > 0 && token === tokenRef.current) {
        prefetch();
        const audio = await itemsRef.current[0]?.audio;
        if (token !== tokenRef.current) return;
        const item = itemsRef.current.shift();
        prefetch();
        if (audio) await play(audio);
        else if (item) await speakWithBrowser(item.text);
      }
    } finally {
      // A cancelled pump must not release the flag a newer pump now owns.
      if (token === tokenRef.current) {
        pumpingRef.current = false;
        setSpeaking(false);
      }
    }
  }, [play, prefetch]);

  const cancel = useCallback((): void => {
    tokenRef.current += 1;
    itemsRef.current = [];
    pumpingRef.current = false;
    audioRef.current?.pause();
    endPlaybackRef.current?.();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string): void => {
      cancel();
      if (!enabledRef.current) return;
      const { sentences, rest } = splitSentences(text);
      const texts = [...sentences, ...flushRemainder(rest)].map(toSpeakable).filter(Boolean);
      if (texts.length === 0) return;
      itemsRef.current = texts.map(sentence => ({ text: sentence }));
      void pump();
    },
    [cancel, pump],
  );

  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) cancel();
  }, [enabled, cancel]);

  return { speaking, speak, cancel };
}

/** The browser's built-in voice: always available, no network. */
function speakWithBrowser(text: string): Promise<void> {
  return new Promise<void>(resolve => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = (): void => resolve();
    utterance.onerror = (): void => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
