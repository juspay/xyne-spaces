import { logger, Event as LogEvent } from '../../utils/logger';
import { AxiosResponse, isAxiosError } from 'axios';
import { apiInstance, BASE_URL } from '../clients/apiClient';

interface VoiceInputResponse {
  success: boolean;
  text: string;
  language?: string;
  durationS?: number;
  error?: string;
}

export interface VoiceStreamMessage {
  type: 'partial' | 'final' | 'error';
  text?: string;
  message?: string;
}

export interface VoiceStreamSession {
  /** Queue an audio chunk (MediaRecorder Blob) to be sent in order. */
  sendChunk(chunk: Blob): void;
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
  openStreamSession(params: { language?: string } = {}): VoiceStreamSession {
    // Derive the WS endpoint from the same API base the Axios client uses, so the
    // stream targets the backend host (e.g. :3001 in dev) rather than the dashboard
    // origin. BASE_URL already includes the `/api` suffix. http→ws, https→wss.
    const wsBase = BASE_URL.replace(/^http/, 'ws');
    const qs = params.language ? `?language=${encodeURIComponent(params.language)}` : '';
    const url = `${wsBase}/voice-input/stream${qs}`;
    const ws = new window.WebSocket(url);
    ws.binaryType = 'arraybuffer';

    // Outbound frames must leave in the order they were produced. Turning a
    // MediaRecorder Blob into an ArrayBuffer is async, so without serialization the
    // end-of-stream signal could overtake (and the socket could drop) the last audio
    // chunk. Chain every send through a single promise and gate it on the socket
    // being ready (resolved on open, or on close/error so tasks unblock and no-op).
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
        // A failed send must not vanish silently: the recorder would keep running,
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
      sendChunk(chunk: Blob) {
        enqueue(async () => {
          await whenReady;
          if (ws.readyState !== window.WebSocket.OPEN) return;
          const buf = await chunk.arrayBuffer();
          if (ws.readyState === window.WebSocket.OPEN) ws.send(buf);
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

  async transcribeAudio(params: {
    audioBlob: Blob;
    mimeType?: string;
    language?: string;
    hints?: string[];
  }): Promise<{ text: string; language?: string; durationS?: number }> {
    const mimeType = params.mimeType || params.audioBlob.type || 'audio/webm';
    const extension = mimeType.includes('ogg')
      ? 'ogg'
      : mimeType.includes('wav')
        ? 'wav'
        : mimeType.includes('mp4') || mimeType.includes('m4a')
          ? 'm4a'
          : 'webm';

    const file = new File([params.audioBlob], `voice-input.${extension}`, {
      type: mimeType,
    });

    const formData = new FormData();
    formData.append('audio', file);

    if (params.language) {
      formData.append('language', params.language);
    }

    if (params.hints && params.hints.length > 0) {
      formData.append('hints', JSON.stringify(params.hints));
    }

    const _blobSizeKB = (params.audioBlob.size / 1024).toFixed(1);
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_info',
      message: String(
        `[VoiceInputService] Sending transcription request | size=${_blobSizeKB}KB` +
          ` | mime=${mimeType} | language=${params.language ?? '(default)'}` +
          ` | hints=${params.hints?.length ?? 0}`,
      ),
    });
    const _t0 = Date.now();

    try {
      const response: AxiosResponse<VoiceInputResponse> = await apiInstance.post(
        '/voice-input/transcribe',
        formData,
      );

      const elapsed = Date.now() - _t0;
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String(
          `[VoiceInputService] Transcription success | elapsed=${elapsed}ms` +
            ` | chars=${response.data.text?.length ?? 0} | language=${response.data.language ?? 'unknown'}`,
        ),
      });
      return {
        text: response.data.text || '',
        ...(response.data.language ? { language: response.data.language } : {}),
        ...(typeof response.data.durationS === 'number'
          ? { durationS: response.data.durationS }
          : {}),
      };
    } catch (error) {
      const elapsed = Date.now() - _t0;
      if (isAxiosError(error)) {
        // Surface the structured error message from the backend when available.
        const backendError =
          (error.response?.data as VoiceInputResponse | undefined)?.error || error.message;
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String(
            `[VoiceInputService] Transcription failed | elapsed=${elapsed}ms` +
              ` | status=${error.response?.status ?? 'network'} | error=${backendError}`,
          ),
          error,
        });
        throw new Error(backendError);
      }
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String(`[VoiceInputService] Unexpected error | elapsed=${elapsed}ms`),
        error: error,
      });
      throw error;
    }
  }
}

export const voiceInputService = new VoiceInputService();
