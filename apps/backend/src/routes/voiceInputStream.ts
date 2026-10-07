import WebSocket, { WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { authMiddleware } from '@/middleware/auth';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { bridgeToElevenLabs } from '@/services/voiceInputElevenLabsStream';
import type { VoiceInputUser } from '@/services/voiceInputKeyterms';
import { warmJev } from '@/services/queryIntent/jevClient';

const VOICE_STREAM_PATH = '/api/voice-input/stream';
const MAX_PENDING_FRAMES = 100;
const AGENT_HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_SESSIONS_PER_USER = 2;

// Open voice-input sockets per user, so one user cannot hold unbounded upstream sessions.
const openSessions = new Map<string, number>();

// Cookie auth alone lets any site open this endpoint with the victim's browser
// (cookies ride along on the WS handshake) and stream audio/results under their
// identity. Require the handshake's Origin to be one of our own allowed origins,
// same allowlist the HTTP CORS middleware uses.
function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !!origin && config.cors.origin.includes(origin);
}

async function authenticateUpgrade(req: IncomingMessage): Promise<VoiceInputUser | null> {
  const cookies: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(part => {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const name = part.slice(0, eqIdx).trim();
        const value = part.slice(eqIdx + 1).trim();
        try {
          cookies[name] = decodeURIComponent(value);
        } catch {
          cookies[name] = value;
        }
      }
    });
  }

  const fakeReq = {
    headers: req.headers,
    cookies,
    ip: (req.socket as Socket & { remoteAddress?: string })?.remoteAddress ?? 'unknown',
    hostname: (req.headers.host ?? 'unknown').split(':')[0],
    get: (h: string) => (req.headers as Record<string, string | undefined>)[h.toLowerCase()],
    method: 'GET',
    path: VOICE_STREAM_PATH,
    body: {},
  } as any;

  return new Promise(resolve => {
    const fakeRes = {
      status: (_code: number) => ({ json: () => resolve(null) }),
      cookie: () => {},
      setHeader: () => {},
    } as any;

    void authMiddleware.authenticate(fakeReq, fakeRes, (err?: unknown) => {
      resolve(
        !err && fakeReq.user
          ? { userId: fakeReq.user.id, workspaceId: fakeReq.user.workspaceId }
          : null
      );
    });
  });
}

function proxyToAgent(clientWs: WebSocket, req: IncomingMessage): void {
  const pythonBase = (config.pythonAgentUrl ?? 'http://localhost:8080')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://');

  const urlObj = new URL(req.url ?? '/', 'http://localhost');
  const language = urlObj.searchParams.get('language') ?? '';
  const format = urlObj.searchParams.get('format');
  const agentUrl =
    `${pythonBase}/transcribe-stream?language=${encodeURIComponent(language)}` +
    (format ? `&format=${encodeURIComponent(format)}` : '');

  const agentWs = new WebSocket(agentUrl);

  // Frames can arrive from the client before the agent socket finishes connecting.
  // For WebM/Opus the first chunk carries the container header, so dropping it would
  // make the whole stream undecodable — buffer until open, then flush in order.
  // Binary frames are audio; text frames are control messages (e.g. the end-of-stream
  // { type: 'eos' } signal) and must be forwarded too, preserving order.
  //
  // The buffer is capped and gated by a handshake timeout: a stalled/slow agent
  // connection must not let a client enqueue audio forever and exhaust memory.
  let agentReady = false;
  let closed = false;
  const pending: Array<{ data: RawData; binary: boolean }> = [];

  const closeBoth = (reason: string): void => {
    if (closed) return;
    closed = true;
    clearTimeout(handshakeTimer);
    pending.length = 0;
    if (clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(JSON.stringify({ type: 'error', message: reason }));
      } catch {
        // socket may already be closing
      }
    }
    if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
      clientWs.close();
    }
    if (agentWs.readyState === WebSocket.OPEN || agentWs.readyState === WebSocket.CONNECTING) {
      agentWs.close();
    }
  };

  const handshakeTimer = setTimeout(() => {
    logger.error('[VoiceInputStream] Python agent WS handshake timed out');
    closeBoth('Upstream connection timed out');
  }, AGENT_HANDSHAKE_TIMEOUT_MS);

  const forwardToAgent = (data: RawData, binary: boolean): void => {
    if (agentReady && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(data, { binary });
    } else if (agentWs.readyState === WebSocket.CONNECTING) {
      if (pending.length >= MAX_PENDING_FRAMES) {
        logger.warn('[VoiceInputStream] Pending frame buffer full while agent connecting, closing');
        closeBoth('Server buffer full');
        return;
      }
      pending.push({ data, binary });
    }
  };

  agentWs.once('open', () => {
    logger.info('[VoiceInputStream] Python agent WS connected');
    clearTimeout(handshakeTimer);
    agentReady = true;
    for (const frame of pending) agentWs.send(frame.data, { binary: frame.binary });
    pending.length = 0;
  });

  clientWs.on('message', (data: RawData, isBinary: boolean) => {
    forwardToAgent(data, isBinary);
  });

  agentWs.on('message', (data: RawData, isBinary: boolean) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      // Preserve the frame type: the agent sends JSON *text* frames, but ws.send(Buffer)
      // defaults to a binary frame, which the browser then can't JSON.parse. Forward
      // text as text so the client's onMessage receives a string.
      clientWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('close', () => {
    clearTimeout(handshakeTimer);
    if (agentWs.readyState === WebSocket.OPEN) agentWs.close();
  });

  agentWs.on('close', () => {
    clearTimeout(handshakeTimer);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  agentWs.on('error', (err: Error) => {
    logger.error('[VoiceInputStream] Agent WS error:', err.message);
    clearTimeout(handshakeTimer);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
      clientWs.close();
    }
  });
}

export function attachVoiceInputStreamHandler(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!(req.url ?? '').startsWith(VOICE_STREAM_PATH)) return;

    if (!isAllowedOrigin(req)) {
      logger.warn(
        `[VoiceInputStream] Rejected upgrade from disallowed origin: ${req.headers.origin ?? '(none)'}`
      );
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    void (async () => {
      try {
        const authed = await authenticateUpgrade(req);
        if (!authed) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        // The client left while it was being authenticated: there is no socket to hold a slot.
        if (socket.destroyed) return;
        const userSessions = openSessions.get(authed.userId) ?? 0;
        if (userSessions >= MAX_SESSIONS_PER_USER) {
          logger.warn('[VoiceInputStream] Rejected upgrade: too many open sessions for user');
          socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
          socket.destroy();
          return;
        }
        // Reserved now, not once upgraded, so handshakes authenticating at the same time cannot
        // all pass the check. Released once: when the socket closes, or the handshake fails.
        openSessions.set(authed.userId, userSessions + 1);
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          const remaining = (openSessions.get(authed.userId) ?? 1) - 1;
          if (remaining > 0) openSessions.set(authed.userId, remaining);
          else openSessions.delete(authed.userId);
        };
        socket.once('close', release);
        // ElevenLabs only accepts raw PCM; older clients still send WebM/Opus and stay on
        // the Python agent.
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const useElevenLabs =
          params.get('format') === 'pcm16' &&
          config.voiceInputStream.provider === 'elevenlabs' &&
          !!config.elevenLabs.apiKey;
        // Only voice mode's hold-to-talk commits manually; chat dictation streams here too.
        const holdToTalk = params.get('commit') === 'manual';
        wss.handleUpgrade(req, socket, head, ws => {
          ws.once('close', release);
          // In voice mode Buddy's routing call follows when the user lets go: open its
          // connection to Jev now so that call does not pay for the handshake.
          if (holdToTalk) warmJev();
          if (useElevenLabs) {
            bridgeToElevenLabs(
              ws,
              params.get('language') ?? '',
              holdToTalk ? 'manual' : 'vad',
              authed
            );
          } else {
            proxyToAgent(ws, req);
          }
        });
      } catch (err) {
        logger.error('[VoiceInputStream] Upgrade error:', err);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    })();
  });

  logger.info(`[VoiceInputStream] WS upgrade handler registered at ${VOICE_STREAM_PATH}`);
}
