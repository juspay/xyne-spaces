import { Server as HttpServer, IncomingMessage } from 'http';
import { performance } from 'perf_hooks';
import { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { encryptedFieldsConfig } from '@xyne/shared';
import { config } from '@/config/env';
import { recordDecryptFailure } from '@/observability/crypto-metrics';
import { logger } from '@/utils/logger';
import { extractAuthDataFromJWT } from '@/zero/auth';
import { decryptServerField, encryptForSession, parseEncryptedField } from '@/zero/field-crypto';
import { getSessionKey } from '@/zero/session-key-store';

const hasEncryptedFields = Object.keys(encryptedFieldsConfig).length > 0;
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKPRESSURE_THRESHOLD = 64 * 1024;
const BACKPRESSURE_RETRY_MS = 50;

interface ProxyConnection {
  clientWs: WebSocket;
  upstreamWs: WebSocket;
  userID: string;
  sessionID: string | null;
  clientID: string | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  connectTimeout: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  keyCache: Map<string, Buffer | null>;
  clientMessageCount: number;
  upstreamMessageCount: number;
}

const activeConnections = new Set<ProxyConnection>();

function roundDurationMs(durationMs: number): number {
  return Number(durationMs.toFixed(3));
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });
  return cookies;
}

function extractWorkspaceToken(cookies: Record<string, string>): string | undefined {
  const workspaceTokenCookie = Object.keys(cookies).find((key) => key.startsWith('xyne_ws_') && key.endsWith('_token'));
  return workspaceTokenCookie ? cookies[workspaceTokenCookie] : cookies['google_access_token'];
}

async function getOrCacheClientKey(conn: ProxyConnection): Promise<Buffer | null> {
  if (!conn.sessionID) return null;
  if (conn.keyCache.has(conn.sessionID)) {
    return conn.keyCache.get(conn.sessionID) ?? null;
  }
  const key = await getSessionKey(conn.sessionID);
  conn.keyCache.set(conn.sessionID, key);
  if (key) conn.keyCache.set(conn.sessionID, key);
  return key;
}

async function transformPokeFields(
  msg: unknown,
  conn: ProxyConnection,
): Promise<unknown | null> {
  let payload: Record<string, unknown> | null = null;
  const isArray = Array.isArray(msg);
  if (isArray && msg[0] === 'pokePart' && msg[1] && typeof msg[1] === 'object') {
    payload = msg[1] as Record<string, unknown>;
  } else if (msg && typeof msg === 'object' && (msg as Record<string, unknown>).type === 'pokePart') {
    payload = msg as Record<string, unknown>;
  }
  if (!payload) return null;

  const rowsPatch = payload.rowsPatch as unknown[] | undefined;
  if (!rowsPatch) return null;

  let clonedMessage: Record<string, unknown> | unknown[] | null = null;
  let clonedPayload: Record<string, unknown> | null = null;
  let clonedRowsPatch: unknown[] | null = null;
  let transformed = false;

  const ensureWritableContainers = () => {
    if (clonedMessage && clonedPayload && clonedRowsPatch) {
      return;
    }

    clonedMessage = isArray ? [...(msg as unknown[])] : { ...(msg as Record<string, unknown>) };
    clonedPayload = isArray
      ? { ...((clonedMessage as unknown[])[1] as Record<string, unknown>) }
      : (clonedMessage as Record<string, unknown>);
    clonedRowsPatch = [...rowsPatch];

    if (isArray) {
      (clonedMessage as unknown[])[1] = clonedPayload;
    }
    clonedPayload.rowsPatch = clonedRowsPatch;
  };

  for (const [patchIndex, patch] of rowsPatch.entries()) {
    if (!patch || typeof patch !== 'object') continue;
    const patchObj = patch as Record<string, unknown>;
    const tableName = patchObj.tableName as string | undefined;
    const tableConfig = tableName ? encryptedFieldsConfig[tableName] : undefined;
    if (!tableConfig || patchObj.op === 'del') continue;

    const valueRow = patchObj.value && typeof patchObj.value === 'object' ? patchObj.value : null;
    const mergeRow = patchObj.merge && typeof patchObj.merge === 'object' ? patchObj.merge : null;
    const row = (valueRow || mergeRow || patchObj) as Record<string, unknown>;
    let writablePatch: Record<string, unknown> | null = null;
    let writableRow: Record<string, unknown> | null = null;

    const ensureWritableRow = (): Record<string, unknown> => {
      ensureWritableContainers();

      if (!clonedRowsPatch) {
        throw new Error('Sync proxy failed to initialize mutable rowsPatch');
      }

      if (!writablePatch) {
        writablePatch = { ...patchObj };
        clonedRowsPatch[patchIndex] = writablePatch;
      }

      if (valueRow) {
        if (!writableRow) {
          writableRow = { ...(valueRow as Record<string, unknown>) };
          writablePatch.value = writableRow;
        }
      } else if (mergeRow) {
        if (!writableRow) {
          writableRow = { ...(mergeRow as Record<string, unknown>) };
          writablePatch.merge = writableRow;
        }
      } else {
        writableRow = writablePatch;
      }

      writableRow.__tableName = tableName;
      return writableRow;
    };

    for (const field of tableConfig.fields) {
      const value = row[field];
      if (typeof value !== 'string') continue;
      const parsed = parseEncryptedField(value);
      if (!parsed || parsed.keyId === 'sess') continue;
      if (!config.enc.enableDbEncryption) continue;

      const plaintext = await decryptServerField(value);
      const nextRow = ensureWritableRow();
      if (config.enc.clientEncryptionEnabled && tableConfig.enforceClientEncryption) {
        const clientKey = await getOrCacheClientKey(conn);
        nextRow[field] = clientKey ? encryptForSession(plaintext, clientKey) : plaintext;
      } else {
        nextRow[field] = plaintext;
      }
      transformed = true;
    }
  }

  return transformed ? clonedMessage : null;
}

function cleanup(conn: ProxyConnection): void {
  if (conn.closed) return;
  conn.closed = true;
  if (conn.heartbeatInterval) clearInterval(conn.heartbeatInterval);
  if (conn.connectTimeout) clearTimeout(conn.connectTimeout);
  conn.keyCache.clear();
  activeConnections.delete(conn);
}

function reportDecryptFailure(conn: ProxyConnection, error: unknown): void {
  recordDecryptFailure('sync_proxy', {
    userId: conn.userID,
    sessionIdPresent: Boolean(conn.sessionID),
  });
  logger.error('sync-proxy field transform failed', {
    userId: conn.userID,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function waitForClientBackpressure(clientWs: WebSocket): Promise<void> {
  while (
    clientWs.readyState === WebSocket.OPEN &&
    clientWs.bufferedAmount > BACKPRESSURE_THRESHOLD
  ) {
    await new Promise((resolve) => setTimeout(resolve, BACKPRESSURE_RETRY_MS));
  }
}

function createSyncProxy(clientWs: WebSocket, req: IncomingMessage): void {
  const cookies = parseCookies(req.headers.cookie || '');
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  logger.info('sync-proxy websocket upgrade received', {
    path: parsedUrl.pathname,
    hasCookieHeader: Boolean(req.headers.cookie),
    hasSecWebSocketProtocol: Boolean(req.headers['sec-websocket-protocol']),
    enableDbEncryption: config.enc.enableDbEncryption,
    clientEncryptionEnabled: config.enc.clientEncryptionEnabled,
  });

  let token = extractWorkspaceToken(cookies);
  if (!token) {
    const secProtocol = req.headers['sec-websocket-protocol'];
    if (secProtocol) {
      const parts = (Array.isArray(secProtocol) ? secProtocol.join(',') : secProtocol).split(',').map((part) => part.trim());
      for (const part of parts) {
        try {
          const json = JSON.parse(Buffer.from(decodeURIComponent(part), 'base64').toString('utf8'));
          if (typeof json.authToken === 'string') {
            token = json.authToken;
            break;
          }
        } catch {}
      }
    }
  }

  const authData = extractAuthDataFromJWT(token);
  if (!authData) {
    logger.warn('sync-proxy unauthorized websocket', {
      path: req.url,
      cookieNames: Object.keys(cookies),
      hasSecWebSocketProtocol: Boolean(req.headers['sec-websocket-protocol']),
    });
    clientWs.close(4401, 'Unauthorized');
    return;
  }

  const upstreamUrl = `${config.zeroCacheUpstream.replace(/^http/, 'ws')}${parsedUrl.pathname}${parsedUrl.search}`;
  const upstreamHeaders: Record<string, string> = {};
  let protocols: string[] | undefined;

  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'sec-websocket-protocol' && value) {
      protocols = Array.isArray(value) ? value.flatMap((v) => v.split(',').map((p) => p.trim())) : value.split(',').map((p) => p.trim());
      continue;
    }
    if (value && !['host', 'upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions'].includes(lowerKey)) {
      upstreamHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  if (token) {
    upstreamHeaders.authorization = `Bearer ${token}`;
  }

  const conn: ProxyConnection = {
    clientWs,
    upstreamWs: null as unknown as WebSocket,
    userID: authData.sub,
    sessionID: cookies.user_session_id || null,
    clientID: parsedUrl.searchParams.get('clientID') || null,
    heartbeatInterval: null,
    connectTimeout: null,
    closed: false,
    keyCache: new Map(),
    clientMessageCount: 0,
    upstreamMessageCount: 0,
  };
  activeConnections.add(conn);
  if (hasEncryptedFields && config.enc.clientEncryptionEnabled) void getOrCacheClientKey(conn);

  logger.info('sync-proxy connecting upstream', {
    userId: authData.sub,
    path: parsedUrl.pathname,
    upstreamUrl: upstreamUrl.replace(parsedUrl.search, ''),
    clientId: conn.clientID,
    sessionIdPresent: Boolean(conn.sessionID),
  });

  const upstreamWs = new WebSocket(upstreamUrl, protocols, {
    headers: upstreamHeaders,
    handshakeTimeout: UPSTREAM_CONNECT_TIMEOUT_MS,
  });
  conn.upstreamWs = upstreamWs;

  conn.connectTimeout = setTimeout(() => {
    if (upstreamWs.readyState !== WebSocket.OPEN) {
      cleanup(conn);
      try { clientWs.close(1013, 'Try Again Later'); } catch {}
    }
  }, UPSTREAM_CONNECT_TIMEOUT_MS);

  upstreamWs.on('open', () => {
    logger.info('sync-proxy upstream connected', {
      userId: conn.userID,
      clientId: conn.clientID,
    });
    if (conn.connectTimeout) clearTimeout(conn.connectTimeout);
    conn.heartbeatInterval = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();
      if (upstreamWs.readyState === WebSocket.OPEN) upstreamWs.ping();
    }, HEARTBEAT_INTERVAL_MS);
  });

  clientWs.on('message', (data, isBinary) => {
    conn.clientMessageCount += 1;
    if (conn.clientMessageCount === 1) {
      logger.info('sync-proxy first client frame received', {
        userId: conn.userID,
        clientId: conn.clientID,
        path: parsedUrl.pathname,
        isBinary,
      });
    }
    if (!conn.closed && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(data as Buffer, { binary: isBinary });
    }
  });

  let upstreamQueue: Promise<void> = Promise.resolve();
  upstreamWs.on('message', (data, isBinary) => {
    conn.upstreamMessageCount += 1;
    if (conn.upstreamMessageCount === 1) {
      logger.info('sync-proxy first upstream frame received', {
        userId: conn.userID,
        clientId: conn.clientID,
        path: parsedUrl.pathname,
        isBinary,
      });
    }
    upstreamQueue = upstreamQueue.then(async () => {
      if (conn.closed) return;
      let messageToSend: Buffer | string = data as Buffer;
      let sendBinary = isBinary;
      if (!isBinary && hasEncryptedFields) {
        try {
          const parsed = JSON.parse(data.toString());
          const transformStartTime = performance.now();
          const transformed = await transformPokeFields(parsed, conn);
          if (transformed) {
            messageToSend = JSON.stringify(transformed);
            sendBinary = false;
            logger.info('sync-proxy pokePart transform latency', {
              type: 'SYNC_PROXY_POKEPART_TRANSFORM_LATENCY',
              userId: conn.userID,
              clientId: conn.clientID,
              path: parsedUrl.pathname,
              upstreamMessageCount: conn.upstreamMessageCount,
              durationMs: roundDurationMs(performance.now() - transformStartTime),
            });
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.warn('sync-proxy received non-JSON upstream frame', {
              userId: conn.userID,
            });
          } else {
            reportDecryptFailure(conn, error);
            throw new Error('Failed to decrypt upstream sync data');
          }
        }
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        await waitForClientBackpressure(clientWs);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(messageToSend, { binary: sendBinary });
        }
      }
    }).catch((error) => {
      logger.error('sync-proxy upstream forwarding failed', {
        userId: conn.userID,
        error: error instanceof Error ? error.message : String(error),
      });
      cleanup(conn);
      try { clientWs.close(1011, 'Proxy forwarding failed'); } catch { clientWs.terminate(); }
      try { upstreamWs.close(1011, 'Proxy forwarding failed'); } catch { upstreamWs.terminate(); }
    });
  });

  clientWs.on('close', (code, reason) => {
    logger.info('sync-proxy client closed', {
      userId: conn.userID,
      clientId: conn.clientID,
      code,
      reason: reason.toString(),
      clientMessageCount: conn.clientMessageCount,
      upstreamMessageCount: conn.upstreamMessageCount,
    });
    if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
      try { upstreamWs.close(code, reason); } catch { upstreamWs.terminate(); }
    }
    cleanup(conn);
  });

  upstreamWs.on('close', (code, reason) => {
    logger.info('sync-proxy upstream closed', {
      userId: conn.userID,
      clientId: conn.clientID,
      code,
      reason: reason.toString(),
      clientMessageCount: conn.clientMessageCount,
      upstreamMessageCount: conn.upstreamMessageCount,
    });
    if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
      try { clientWs.close(code, reason); } catch { clientWs.terminate(); }
    }
    cleanup(conn);
  });

  clientWs.on('error', () => {
    cleanup(conn);
    try { upstreamWs.terminate(); } catch {}
  });

  upstreamWs.on('error', (err) => {
    logger.error('sync-proxy upstream error', {
      error: err instanceof Error ? err.message : String(err),
    });
    cleanup(conn);
    try { clientWs.terminate(); } catch {}
  });
}

export function setupWsUpgradeHandler(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/zero/sync')) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => createSyncProxy(ws, req));
  });
}

export function shutdownSyncProxy(): void {
  for (const conn of activeConnections) {
    try {
      if (conn.clientWs.readyState === WebSocket.OPEN) conn.clientWs.close(1001, 'Going Away');
      if (conn.upstreamWs.readyState === WebSocket.OPEN) conn.upstreamWs.close(1001, 'Going Away');
    } catch {}
    cleanup(conn);
  }
}
