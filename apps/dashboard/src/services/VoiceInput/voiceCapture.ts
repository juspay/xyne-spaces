import { isPcmCaptureSupported, startPcmCapture, type PcmCapture } from './pcmCapture';
import { voiceInputService, type VoiceStreamSession } from './voiceInputService';
import { voiceDebug } from './voiceDebug';

// The status strip counts frames, updated once a second (ten 100 ms frames) rather than per frame.
const STATUS_EVERY_FRAMES = 10;

// Safety net after end-of-audio: if the server never closes the stream, force-close it so
// callers can't stay on "transcribing".
const FORCE_CLOSE_MS = 12000;

export interface UtteranceOptions {
  /** Language to transcribe in ('en'); the server detects it when omitted. */
  language?: string;
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
  let frames = 0;
  let bytes = 0;
  let firstFrameLogged = false;
  const countFrame = (frame: ArrayBuffer): void => {
    frames++;
    bytes += frame.byteLength;
    if (!firstFrameLogged) {
      firstFrameLogged = true;
      voiceDebug.log('mic', 'First audio frame', `${frame.byteLength} bytes`);
    }
    if (frames % STATUS_EVERY_FRAMES === 0) {
      voiceDebug.setStatus({ framesSent: frames, bytesSent: bytes });
    }
  };

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
      voiceDebug.setStatus({ mic: 'starting', micLabel: '', framesSent: 0, bytesSent: 0 });
      opened = await startPcmCapture({
        onFrame: frame => {
          countFrame(frame);
          session?.sendChunk(frame);
        },
        onLevel: level => options.onLevel?.(level),
        deviceId: options.deviceId,
        onStep: (step, detail) => {
          voiceDebug.log('mic', step, detail);
          if (step === 'Audio context' || step === 'Audio running') {
            voiceDebug.setStatus({
              audioContext: detail?.split(',')[0]?.replace('context ', '') ?? '',
            });
          }
        },
      });
      if (over) {
        opened.stop();
        return;
      }
      capture = opened;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : String(error);
      voiceDebug.log('mic', 'Microphone failed', `${name}: ${message}`, { level: 'error' });
      voiceDebug.setStatus({ mic: 'error' });
      if (!over) ready.reject(error);
      return;
    }
    voiceDebug.setStatus({ mic: 'live', micLabel: opened.label });
    const open = voiceInputService.openStreamSession({
      format: 'pcm16',
      ...(options.commit && { commit: options.commit }),
      ...(options.language && { language: options.language }),
    });
    session = open;
    const openedAt = performance.now();
    voiceDebug.log('socket', 'Connecting', 'voice-input/stream, pcm16');
    voiceDebug.setStatus({ socket: 'connecting' });
    open.onOpen(() => {
      voiceDebug.log('socket', 'Open', `after ${Math.round(performance.now() - openedAt)}ms`);
      voiceDebug.setStatus({ socket: 'open' });
    });
    open.onMessage(msg => {
      voiceDebug.setStatus({ lastServerMessage: msg.type });
      if (msg.type === 'error') {
        voiceDebug.log('stt', 'Server error', msg.message ?? 'no message', { level: 'error' });
      } else if (msg.type === 'final') {
        voiceDebug.log('stt', 'Final phrase', `“${msg.text ?? ''}”`);
      }
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
    open.onClose(event => {
      voiceDebug.log(
        'socket',
        'Closed',
        `code ${event.code}${event.reason ? ` (${event.reason})` : ''}, ${frames} frames / ${bytes} bytes sent`,
        { level: event.code === 1000 || event.code === 1005 ? 'info' : 'warn' },
      );
      voiceDebug.setStatus({ socket: 'closed', mic: 'off', framesSent: frames, bytesSent: bytes });
      if (!finish()) return;
      session = null;
      ended.resolve(committed());
    });
    open.onError(() => {
      voiceDebug.log('socket', 'Error', 'the socket failed (auth, origin or network)', {
        level: 'error',
      });
      voiceDebug.setStatus({ socket: 'error' });
      fail(new Error('Voice stream disconnected unexpectedly'));
    });
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
