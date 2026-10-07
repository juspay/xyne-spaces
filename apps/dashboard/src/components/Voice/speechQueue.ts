import {
  pickVoice,
  ttsService,
  type SynthesizedSpeech,
} from '../../services/VoiceInput/ttsService';
import { getVoiceSettings } from './voiceSettings';

// A synthesized sentence and the voice it was spoken in, or null when the server voice is unavailable.
type SpeechAudio = Promise<(SynthesizedSpeech & { voiceName: string | undefined }) | null>;

interface SpeechQueueOptions {
  log: (step: string, detail?: string) => void;
  // Audio started playing this sentence.
  onSpeaking: (sentence: string) => void;
  // The queue ran dry, was cancelled, or stopped because the browser blocked playback.
  onDrained: () => void;
  // The browser refused to start audio without a user gesture, or that was resolved.
  onBlocked: (blocked: boolean) => void;
}

export interface SpeechQueue {
  enqueue: (sentences: string[]) => void;
  // Synthesizes sentences in the background so that enqueueing them later starts at once; plays nothing.
  warm: (sentences: string[]) => Promise<void>;
  cancel: () => void;
  // True while sentences are queued or playing.
  isBusy: () => boolean;
  // Retries blocked playback; call it inside a click.
  resume: () => void;
}

/**
 * Speaks sentences one after another with the server voice, falling back to the browser's own
 * voice. The next sentence is synthesized while the current one plays, so speech has no gaps.
 */
export function createSpeechQueue({
  log,
  onSpeaking,
  onDrained,
  onBlocked,
}: SpeechQueueOptions): SpeechQueue {
  let pending: string[] = [];
  // Bumped by cancel(): a pump started in an older generation stops without playing anything more.
  let generation = 0;
  let pumpingGeneration: number | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let playResolve: (() => void) | null = null;
  let prefetch: { text: string; audio: SpeechAudio } | null = null;

  const synthesize = async (text: string): SpeechAudio => {
    try {
      const voice = pickVoice(await ttsService.voices(), getVoiceSettings().voiceId);
      const speech = await ttsService.synthesize(text, voice?.id);
      return { ...speech, voiceName: voice?.name };
    } catch (err) {
      log('Error', `server voice failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    }
  };

  // Resolves true once the sentence was heard, false when the browser refused to play it.
  const play = (sentence: string, audio: Awaited<SpeechAudio>): Promise<boolean> =>
    new Promise<boolean>(resolve => {
      // A cancelled sentence's late onended/onerror must not clear the next sentence's resolver.
      const done = (): void => {
        if (playResolve === done) playResolve = null;
        resolve(true);
      };
      const refused = (): void => {
        if (playResolve === done) playResolve = null;
        resolve(false);
      };
      playResolve = done;
      if (audio) {
        const el = new Audio(`data:${audio.mimeType};base64,${audio.audioBase64}`);
        audioEl = el;
        el.onended = done;
        el.onerror = done;
        void el.play().catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') refused();
          else done();
        });
        return;
      }
      // Server voice unavailable: the browser's own voice reads it instead.
      if (typeof speechSynthesis === 'undefined') {
        done();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.onend = done;
      utterance.onerror = (event): void => {
        if (event.error === 'not-allowed') refused();
        else done();
      };
      speechSynthesis.speak(utterance);
    });

  const pump = async (): Promise<void> => {
    const mine = generation;
    if (pumpingGeneration === mine) return;
    pumpingGeneration = mine;
    try {
      while (pending.length > 0 && generation === mine) {
        const sentence = pending.shift() as string;
        const requestedAt = performance.now();
        log('TTS requested', `${sentence.length} chars`);
        const prefetched = prefetch;
        prefetch = null;
        const audio = await (prefetched?.text === sentence
          ? prefetched.audio
          : synthesize(sentence));
        // Cancelled while synthesizing: this sentence must not play over whatever came next.
        if (generation !== mine) return;
        const next = pending[0];
        if (next) prefetch = { text: next, audio: synthesize(next) };
        log(
          'TTS started',
          `${audio ? `${audio.voiceName ?? 'Default'} (server voice)` : 'browser voice'} · ${Math.round(performance.now() - requestedAt)}ms`,
        );
        onSpeaking(sentence);
        if (!(await play(sentence, audio))) {
          // Nothing was heard, so the sentence stays queued for resume().
          pending.unshift(sentence);
          log('Playback blocked', 'tap to hear');
          onBlocked(true);
          onDrained();
          return;
        }
      }
    } finally {
      if (generation === mine) {
        pumpingGeneration = null;
        if (pending.length === 0) onDrained();
      }
    }
  };

  const isBusy = (): boolean => pumpingGeneration === generation || pending.length > 0;

  return {
    enqueue(sentences): void {
      pending.push(...sentences);
      void pump();
    },
    async warm(sentences): Promise<void> {
      // One at a time: this is not worth crowding out the request for a reply being spoken.
      for (const sentence of sentences) await synthesize(sentence);
    },
    cancel(): void {
      const wasBusy = isBusy();
      generation++;
      pending = [];
      prefetch = null;
      onBlocked(false);
      if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
        audioEl = null;
      }
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      const resolve = playResolve;
      playResolve = null;
      resolve?.();
      if (wasBusy) onDrained();
    },
    isBusy,
    resume(): void {
      onBlocked(false);
      void pump();
    },
  };
}
