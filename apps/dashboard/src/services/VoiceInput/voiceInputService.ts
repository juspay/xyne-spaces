import { logger, Event as LogEvent } from '../../utils/logger';
import { BASE_URL } from '../clients/apiClient';

export interface VoiceStreamMessage {
  type: 'partial' | 'final' | 'error';
  text?: string;
  message?: string;
}

export interface VoiceStreamSession {
  /** Queue a PCM audio frame to be sent in order. */
  sendChunk(frame: ArrayBuffer): void;
  /** Flush queued audio, then signal end-of-stream and wait for the server to
   *  send the final transcript and close. Does NOT close the socket itself. */
  endAudio(): void;
  /** Hard-close immediately (abort / error / unmount) — may drop the tail. */
  close(): void;
  onMessage(handler: (msg: VoiceStreamMessage) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (ev: Event) => void): void;
}

class VoiceInputService {
  openStreamSession(
    params: { language?: string; format?: 'pcm16'; commit?: 'manual' } = {},
  ): VoiceStreamSession {
    // Derive the WS endpoint from the same API base the Axios client uses, so the
    // stream targets the backend host (e.g. :3001 in dev) rather than the dashboard
    // origin. BASE_URL already includes the `/api` suffix. http→ws, https→wss.
    const wsBase = BASE_URL.replace(/^http/, 'ws');
    const query = new URLSearchParams();
    if (params.format) query.set('format', params.format);
    if (params.commit) query.set('commit', params.commit);
    if (params.language) query.set('language', params.language);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const url = `${wsBase}/voice-input/stream${qs}`;
    const ws = new window.WebSocket(url);
    ws.binaryType = 'arraybuffer';

    // Outbound frames must leave in the order they were produced, and audio arrives
    // before the socket opens. Chain every send through a single promise and gate it
    // on the socket being ready (resolved on open, or on close/error so tasks unblock
    // and no-op), so the end-of-stream signal can't overtake the last audio frame.
    let sendChain: Promise<void> = Promise.resolve();
    const whenReady = new Promise<void>(resolve => {
      if (ws.readyState === window.WebSocket.OPEN) {
        resolve();
      } else {
        const done = (): void => resolve();
        ws.addEventListener('open', done, { once: true });
        ws.addEventListener('close', done, { once: true });
        ws.addEventListener('error', done, { once: true });
      }
    });
    const enqueue = (task: () => Promise<void>): void => {
      sendChain = sendChain.then(task).catch(error => {
        // A failed send must not vanish silently: capture would keep running,
        // dropping every subsequent chunk, while the UI still shows "transcribing".
        // Close the socket so the existing onClose cleanup path stops the session.
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[VoiceInputService] Stream send failed, closing session'),
          error: error,
        });
        if (
          ws.readyState === window.WebSocket.OPEN ||
          ws.readyState === window.WebSocket.CONNECTING
        ) {
          ws.close();
        }
      });
    };

    return {
      sendChunk(frame: ArrayBuffer) {
        enqueue(async () => {
          await whenReady;
          if (ws.readyState === window.WebSocket.OPEN) ws.send(frame);
        });
      },
      endAudio() {
        enqueue(async () => {
          await whenReady;
          if (ws.readyState === window.WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'eos' }));
          }
        });
      },
      close() {
        if (
          ws.readyState === window.WebSocket.OPEN ||
          ws.readyState === window.WebSocket.CONNECTING
        ) {
          ws.close();
        }
      },
      onMessage(handler: (msg: VoiceStreamMessage) => void) {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            // Frames are JSON text, but tolerate a binary-wrapped payload too.
            const raw =
              typeof event.data === 'string'
                ? event.data
                : new TextDecoder().decode(event.data as ArrayBuffer);
            const msg = JSON.parse(raw) as VoiceStreamMessage;
            handler(msg);
          } catch {
            // ignore malformed frames
          }
        });
      },
      onClose(handler: () => void) {
        ws.addEventListener('close', handler);
      },
      onError(handler: (ev: Event) => void) {
        ws.addEventListener('error', handler);
      },
    };
  }
}

export const voiceInputService = new VoiceInputService();
