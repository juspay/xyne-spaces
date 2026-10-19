import {
  pickVoice,
  ttsService,
  type SynthesizedSpeech,
} from '../../services/VoiceInput/ttsService';
import { getVoiceSettings } from './voiceSettings';

type SpeechAudio = Promise<(SynthesizedSpeech & { voiceName: string | undefined }) | null>;

interface SpeechQueueOptions {
  log: (step: string, detail?: string) => void;
  onSpeaking: (sentence: string) => void;
  onDrained: () => void;
  onBlocked: (blocked: boolean) => void;
}

export interface SpeechQueue {
  enqueue: (sentences: string[]) => void;
  cancel: () => void;
  isBusy: () => boolean;
  // Call it inside a click (autoplay policy).
  resume: () => void;
}

/** Speaks sentences in order, synthesizing the next while the current one plays so there are no gaps. */
export function createSpeechQueue({
  log,
  onSpeaking,
  onDrained,
  onBlocked,
}: SpeechQueueOptions): SpeechQueue {
  let pending: string[] = [];
  // Bumped by cancel() so an older pump stops without playing more.
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
        // Cancelled while synthesizing: do not play over whatever came next.
        if (generation !== mine) return;
        const next = pending[0];
        if (next) prefetch = { text: next, audio: synthesize(next) };
        log(
          'TTS started',
          `${audio ? `${audio.voiceName ?? 'Default'} (server voice)` : 'browser voice'} · ${Math.round(performance.now() - requestedAt)}ms`,
        );
        onSpeaking(sentence);
        if (!(await play(sentence, audio))) {
          // Stays queued for resume().
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
