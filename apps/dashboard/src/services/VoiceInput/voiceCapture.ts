import { isPcmCaptureSupported, startPcmCapture, type PcmCapture } from './pcmCapture';
import { voiceInputService, type VoiceStreamSession } from './voiceInputService';

// Safety net after end-of-audio: if the server never closes the stream, force-close it so
// callers can't stay on "transcribing".
const FORCE_CLOSE_MS = 12000;

export interface UtteranceOptions {
  /** 'manual' ends the utterance only when stopped; by default the server also ends phrases on silence. */
  commit?: 'manual';
  /** Microphone to use; the default one when omitted or no longer available. */
  deviceId?: string | null | undefined;
  /** Live text of the phrase being spoken, and everything finalized so far. */
  onPartial?: (text: string, committed: string) => void;
  /** A finalized phrase, and everything finalized so far. */
  onFinal?: (text: string, committed: string) => void;
  /** Loudness 0..1 of the microphone; 0 once it is released. */
  onLevel?: (level: number) => void;
}

/** One spoken utterance: the microphone streamed to the transcription socket. */
export interface Utterance {
  /** Resolves with the microphone's name once audio is flowing; rejects if it cannot be used. */
  ready: Promise<string>;
  /** Resolves with the final transcript when the stream closes, whoever closed it; rejects on a stream error. Never settles if `ready` rejected or the utterance was cancelled. */
  ended: Promise<string>;
  /** Releases the microphone and waits for the final transcript; before the microphone is ready, cancels. */
  stop: () => void;
  /** Hard stop: releases the microphone and drops the stream. A cancelled utterance reports nothing. */
  cancel: () => void;
}

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Why the microphone could not be used, for a toast. */
export function micErrorMessage(error: unknown): string {
  if (!isPcmCaptureSupported()) return 'Voice recording is not supported in this browser';
  return error instanceof DOMException && error.name === 'NotAllowedError'
    ? 'Microphone permission denied'
    : 'Failed to start voice recording';
}

/**
 * Starts capturing an utterance. Call it from the user's press or click: the audio context is
 * resumed there. The microphone is opened asynchronously, so cancelling before it is ready
 * still releases it as soon as it arrives.
 */
export function startUtterance(options: UtteranceOptions = {}): Utterance {
  const ready = deferred<string>();
  const ended = deferred<string>();
  const finals: string[] = [];
  let capture: PcmCapture | null = null;
  let session: VoiceStreamSession | null = null;
  let closeTimer: number | undefined;
  let stopped = false;
  let over = false;

  const committed = (): string => finals.join(' ').trim();
  const release = (): void => {
    capture?.stop();
    capture = null;
    options.onLevel?.(0);
  };
  // Ends the utterance; false when it was already over.
  const finish = (): boolean => {
    if (over) return false;
    over = true;
    window.clearTimeout(closeTimer);
    release();
    return true;
  };
  const cancel = (): void => {
    if (!finish()) return;
    session?.close();
    session = null;
  };
  const fail = (error: Error): void => {
    const open = session;
    if (!finish()) return;
    session = null;
    open?.close();
    ended.reject(error);
  };

  void (async (): Promise<void> => {
    let opened: PcmCapture;
    try {
      // Frames are sent through `session`, which is open by the time the first one arrives.
      opened = await startPcmCapture({
        onFrame: frame => session?.sendChunk(frame),
        onLevel: level => options.onLevel?.(level),
        deviceId: options.deviceId,
      });
      if (over) {
        opened.stop();
        return;
      }
      capture = opened;
    } catch (error) {
      if (!over) ready.reject(error);
      return;
    }
    const open = voiceInputService.openStreamSession({
      format: 'pcm16',
      ...(options.commit && { commit: options.commit }),
    });
    session = open;
    open.onMessage(msg => {
      if (over) return;
      if (msg.type === 'partial' && msg.text) {
        options.onPartial?.(msg.text, committed());
      } else if (msg.type === 'final' && msg.text) {
        finals.push(msg.text.trim());
        options.onFinal?.(msg.text.trim(), committed());
      } else if (msg.type === 'error') {
        fail(new Error(msg.message ?? 'Streaming error'));
      }
    });
    open.onClose(() => {
      if (!finish()) return;
      session = null;
      ended.resolve(committed());
    });
    open.onError(() => fail(new Error('Voice stream disconnected unexpectedly')));
    ready.resolve(opened.label);
  })();

  return {
    ready: ready.promise,
    ended: ended.promise,
    stop(): void {
      if (over || stopped) return;
      const open = session;
      // Stopped before the mic was ready: nothing was heard, so end with an empty transcript.
      if (!capture || !open) {
        cancel();
        ended.resolve('');
        return;
      }
      stopped = true;
      // Flushes the last buffered frame, then the server sends the final and closes.
      release();
      open.endAudio();
      closeTimer = window.setTimeout(() => open.close(), FORCE_CLOSE_MS);
    },
    cancel,
  };
}
