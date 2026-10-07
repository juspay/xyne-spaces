import WebSocket from 'ws';
import type { RawData } from 'ws';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { buildKeyterms, type VoiceInputUser } from '@/services/voiceInputKeyterms';

const TAG = '[VoiceInputStream]';
const MAX_PENDING_FRAMES = 100;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const EOS_TIMEOUT_MS = 5_000;
// With VAD a segment committed just before eos can land ahead of eos' own commit; wait
// this long after the last commit reply so a trailing segment is not cut off.
const VAD_EOS_SETTLE_MS = 300;
const SAMPLE_RATE = 16_000;

// Upstream message_types that mean the session cannot continue.
const UPSTREAM_ERROR_TYPES = new Set([
  'auth_error',
  'quota_exceeded',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'chunk_size_exceeded',
  'input_error',
  'transcriber_error',
]);

function audioChunkMessage(audioBase64: string, commit: boolean): string {
  return JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: audioBase64,
    commit,
    sample_rate: SAMPLE_RATE,
  });
}

/**
 * Bridges an accepted client socket to ElevenLabs realtime STT, translating between the
 * client protocol (binary PCM16 audio, { type: 'eos' }; JSON partial/final/error replies)
 * and ElevenLabs' (base64 audio chunks, committed transcripts). The API key stays server
 * side. Transcript text is never logged.
 *
 * `manual` suits push-to-talk: only eos commits, so its reply ends the session at once.
 * `vad` suits dictation: segments commit at pauses, so the text lands as the user speaks.
 */
export function bridgeToElevenLabs(
  clientWs: WebSocket,
  language: string,
  commitStrategy: 'manual' | 'vad',
  user: VoiceInputUser
): void {
  const { apiKey, sttUrl: url, sttModel: model } = config.elevenLabs;
  const startedAt = Date.now();

  let upstream: WebSocket | null = null;
  let upstreamReady = false;
  let eosRequested = false;
  let eosSent = false;
  let closed = false;
  let finals = 0;
  const pending: string[] = [];
  let eosTimer: NodeJS.Timeout | undefined;
  let settleTimer: NodeJS.Timeout | undefined;

  const handshakeTimer = setTimeout(() => {
    logger.error(`${TAG} ElevenLabs WS handshake timed out`);
    finish('handshake_timeout', 'Upstream connection timed out');
  }, HANDSHAKE_TIMEOUT_MS);

  const finish = (outcome: string, clientError?: string): void => {
    if (closed) return;
    closed = true;
    clearTimeout(handshakeTimer);
    clearTimeout(eosTimer);
    clearTimeout(settleTimer);
    pending.length = 0;
    if (clientError && clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(JSON.stringify({ type: 'error', message: clientError }));
      } catch {
        // socket may already be closing
      }
    }
    if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
      clientWs.close();
    }
    if (
      upstream &&
      (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)
    ) {
      upstream.close();
    }
    logger.info(
      `${TAG} provider=elevenlabs durationMs=${Date.now() - startedAt} finals=${finals} outcome=${outcome}`
    );
  };

  const sendCommit = (): void => {
    eosSent = true;
    upstream?.send(audioChunkMessage('', true));
    // The committed transcript normally follows within a fraction of a second.
    eosTimer = setTimeout(() => finish('eos_timeout'), EOS_TIMEOUT_MS);
  };

  // After eos: manual ends on the first commit reply; vad waits for the replies to settle.
  const onCommitReplyAfterEos = (): void => {
    if (commitStrategy === 'manual') {
      finish('ok');
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => finish('ok'), VAD_EOS_SETTLE_MS);
  };

  const sendToClient = (payload: { type: 'partial' | 'final'; text: string }): void => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
  };

  clientWs.on('message', (data: RawData, isBinary: boolean) => {
    if (closed || eosRequested) return;
    if (isBinary) {
      const message = audioChunkMessage((data as Buffer).toString('base64'), false);
      if (upstreamReady && upstream?.readyState === WebSocket.OPEN) {
        upstream.send(message);
      } else if (pending.length >= MAX_PENDING_FRAMES) {
        logger.warn(`${TAG} Pending frame buffer full while ElevenLabs connecting, closing`);
        finish('buffer_full', 'Server buffer full');
      } else {
        pending.push(message);
      }
      return;
    }
    try {
      if (JSON.parse(data.toString()).type !== 'eos') return;
    } catch {
      return;
    }
    eosRequested = true;
    if (upstreamReady && upstream?.readyState === WebSocket.OPEN) sendCommit();
  });

  clientWs.on('close', () => finish('client_closed'));
  clientWs.on('error', () => finish('client_error'));

  void (async () => {
    const query = new URLSearchParams({
      model_id: model,
      audio_format: 'pcm_16000',
      commit_strategy: commitStrategy,
      // Drops background speech and noise so only the nearby speaker is transcribed.
      filter_background_audio: 'true',
    });
    // ElevenLabs takes a bare language code ('en', 'hi'), not a locale like 'en-IN'.
    const languageCode = language.split('-')[0];
    if (languageCode) query.set('language_code', languageCode);
    for (const term of await buildKeyterms(user)) query.append('keyterms', term);
    if (closed) return;

    upstream = new WebSocket(`${url}/v1/speech-to-text/realtime?${query.toString()}`, {
      headers: { 'xi-api-key': apiKey },
    });

    upstream.once('open', () => {
      clearTimeout(handshakeTimer);
      upstreamReady = true;
      for (const message of pending) upstream?.send(message);
      pending.length = 0;
      if (eosRequested) sendCommit();
    });

    upstream.on('message', (data: RawData) => {
      let msg: { message_type?: string; text?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (msg.message_type === 'partial_transcript') {
        sendToClient({ type: 'partial', text });
      } else if (msg.message_type === 'committed_transcript') {
        if (text.trim()) {
          finals++;
          sendToClient({ type: 'final', text });
        }
        if (eosSent) onCommitReplyAfterEos();
      } else if (
        msg.message_type === 'insufficient_audio_activity' ||
        msg.message_type === 'commit_throttled'
      ) {
        // After eos these just mean there was nothing left to commit (nothing said, or
        // VAD already committed it).
        if (eosSent) onCommitReplyAfterEos();
      } else if (msg.message_type === 'session_time_limit_exceeded') {
        // Everything committed so far was already sent; end like a normal stop.
        finish('session_time_limit');
      } else if (msg.message_type && UPSTREAM_ERROR_TYPES.has(msg.message_type)) {
        logger.error(`${TAG} ElevenLabs error: ${msg.message_type}`);
        finish(msg.message_type, 'Transcription unavailable');
      }
    });

    // After eos the upstream closing is the normal end; before it, the session failed.
    upstream.on('close', () =>
      finish('upstream_closed', eosSent ? undefined : 'Transcription unavailable')
    );
    upstream.on('error', (err: Error) => {
      logger.error(`${TAG} ElevenLabs WS error:`, err.message);
      finish('upstream_error', 'Transcription unavailable');
    });
  })();
}
