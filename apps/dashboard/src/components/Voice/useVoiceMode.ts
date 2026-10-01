import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { voiceInputService } from '../../services/VoiceInput/voiceInputService';
import { ttsService } from '../../services/VoiceInput/ttsService';
import { xyneAIStreamManager, type StreamState } from '../../services/XyneAI';
import { splitSentences, flushRemainder, toSpokenText } from './voiceSentences';

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

interface UseVoiceModeParams {
  enabled: boolean;
  submit: (text: string) => void;
  ownsStream: (state: StreamState) => boolean;
  // A reply to speak, '' when the assistant took the text but has nothing to say, or null to submit it.
  answer?: (text: string) => Promise<string | null>;
  voice?: string;
}

interface UseVoiceModeResult {
  phase: VoicePhase;
  level: number;
  startRecording: () => void;
  stopRecording: () => void;
  cancelPlayback: () => void;
}

function latestBotContent(messages: StreamState['messages']): string | null {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  if (!bot) return null;
  if (bot.parsedContent?.summary) return bot.parsedContent.summary;
  const stream = bot.streamingContent || bot.content || '';
  const head = stream.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return null;
  return stream || null;
}

export function useVoiceMode({
  enabled,
  submit,
  ownsStream,
  answer,
  voice,
}: UseVoiceModeParams): UseVoiceModeResult {
  // Read inside the async callback created at record start, so they must be the latest versions.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const answerRef = useRef(answer);
  answerRef.current = answer;

  const [phase, setPhase] = useState<VoicePhase>('idle');
  const phaseRef = useRef<VoicePhase>('idle');
  const setPhaseSafe = useCallback((next: VoicePhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [level, setLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const consumedRef = useRef(0);
  const turnActiveRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);

  const pendingTextRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pumpingRef = useRef(false);
  const playResolveRef = useRef<(() => void) | null>(null);

  const stopMeter = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream): void => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = (): void => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const x = (sample - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      audioCtxRef.current = null;
    }
  }, []);

  const stopStream = useCallback((): void => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const cancelPlayback = useCallback((): void => {
    pendingTextRef.current = [];
    pumpingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (playResolveRef.current) {
      const resolve = playResolveRef.current;
      playResolveRef.current = null;
      resolve();
    }
  }, []);

  const pump = useCallback(async (): Promise<void> => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (pendingTextRef.current.length > 0) {
        const sentence = pendingTextRef.current.shift() as string;
        const audio = await ttsService.synthesize(sentence, voice).catch(() => null);
        if (!pumpingRef.current) return;
        setPhaseSafe('speaking');
        await new Promise<void>(resolve => {
          const done = (): void => {
            playResolveRef.current = null;
            resolve();
          };
          playResolveRef.current = done;
          if (audio) {
            const el = new Audio(`data:${audio.mimeType};base64,${audio.audioBase64}`);
            audioRef.current = el;
            el.onended = done;
            el.onerror = done;
            void el.play().catch(done);
            return;
          }
          // Server voice unavailable: the browser's own voice reads it instead.
          if (typeof speechSynthesis === 'undefined') {
            done();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(sentence);
          utterance.onend = done;
          utterance.onerror = done;
          speechSynthesis.speak(utterance);
        });
      }
    } finally {
      pumpingRef.current = false;
      if (
        pendingTextRef.current.length === 0 &&
        !turnActiveRef.current &&
        phaseRef.current === 'speaking'
      ) {
        setPhaseSafe('idle');
      }
    }
  }, [voice, setPhaseSafe]);

  const enqueue = useCallback(
    (sentences: string[]): void => {
      if (sentences.length === 0) return;
      pendingTextRef.current.push(...sentences);
      void pump();
    },
    [pump],
  );

  const processReply = useCallback(
    (fullText: string, done: boolean): void => {
      if (done) {
        const tail = flushRemainder(fullText.slice(consumedRef.current));
        consumedRef.current = fullText.length;
        enqueue(tail);
        if (tail.length === 0 && pendingTextRef.current.length === 0 && !pumpingRef.current) {
          setPhaseSafe('idle');
        }
        return;
      }
      const { sentences, rest } = splitSentences(fullText.slice(consumedRef.current));
      if (sentences.length > 0) {
        consumedRef.current = fullText.length - rest.length;
        enqueue(sentences);
      }
    },
    [enqueue, setPhaseSafe],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    return xyneAIStreamManager.subscribe((state: StreamState): void => {
      if (!turnActiveRef.current) return;
      if (!ownsStream(state)) return;
      if (activeStreamIdRef.current === null) {
        if (state.status !== 'streaming') return;
        activeStreamIdRef.current = state.streamId;
      } else if (state.streamId !== activeStreamIdRef.current) {
        return;
      }
      const content = latestBotContent(state.messages);
      const done = state.status !== 'streaming';
      if (content !== null) processReply(content, done);
      if (done) {
        turnActiveRef.current = false;
        activeStreamIdRef.current = null;
      }
    });
  }, [enabled, ownsStream, processReply]);

  const transcribe = useCallback(
    async (blob: Blob): Promise<void> => {
      setPhaseSafe('transcribing');
      try {
        const result = await voiceInputService.transcribeAudio({ audioBlob: blob });
        const text = result.text.trim();
        if (!text) {
          setPhaseSafe('idle');
          return;
        }
        setPhaseSafe('thinking');
        const reply = answerRef.current ? await answerRef.current(text) : null;
        if (reply === '') {
          setPhaseSafe('idle');
          return;
        }
        if (reply !== null) {
          const { sentences, rest } = splitSentences(toSpokenText(reply));
          enqueue([...sentences, ...flushRemainder(rest)]);
          return;
        }
        consumedRef.current = 0;
        activeStreamIdRef.current = null;
        turnActiveRef.current = true;
        submitRef.current(text);
      } catch (err) {
        toast.error('Voice transcription failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
        setPhaseSafe('idle');
      }
    },
    [enqueue, setPhaseSafe],
  );

  const startRecording = useCallback((): void => {
    if (phaseRef.current === 'listening') return;
    cancelPlayback();
    void (async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        chunksRef.current = [];
        startMeter(stream);
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e): void => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = (): void => {
          stopMeter();
          stopStream();
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          chunksRef.current = [];
          if (blob.size > 0) void transcribe(blob);
          else setPhaseSafe('idle');
        };
        recorderRef.current = recorder;
        recorder.start();
        setPhaseSafe('listening');
      } catch {
        toast.error('Microphone access denied');
        setPhaseSafe('idle');
      }
    })();
  }, [cancelPlayback, stopStream, transcribe, setPhaseSafe, startMeter, stopMeter]);

  const stopRecording = useCallback((): void => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopRecording();
      stopMeter();
      cancelPlayback();
      turnActiveRef.current = false;
      activeStreamIdRef.current = null;
      setPhaseSafe('idle');
    }
  }, [enabled, stopRecording, stopMeter, cancelPlayback, setPhaseSafe]);

  useEffect(
    () => (): void => {
      stopMeter();
      stopStream();
      cancelPlayback();
    },
    [stopMeter, stopStream, cancelPlayback],
  );

  return { phase, level, startRecording, stopRecording, cancelPlayback };
}
