/**
 * Generic proxy for SDLC traffic: main (CORE role) forwards the request
 * verbatim to the private SDLC-role backend at SDLC_RUNTIME_URL, using the
 * original path, and streams the response straight back — one code path for
 * plain JSON, SSE, and downloads. Main's own auth middleware has already run
 * by the time this executes; the SDLC backend re-checks S2S + auth itself.
 */
import type { NextFunction, Request, Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { Agent } from 'undici';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';

// Headers a client should never be able to spoof — always server-set below,
// from values Express itself derived (trusting only its own proxy config,
// not raw client input).
const STRIPPED_INBOUND_HEADERS = [
  'x-s2s-key',
  'x-trace-id',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
];

// Hop-by-hop / connection-specific headers that must not be replayed verbatim
// in either direction. content-encoding is here because fetch() transparently
// decompresses upstream.body for us (undici applies Content-Encoding before
// exposing the stream) — forwarding the original header would tell the
// client to gunzip bytes that are already plain, which corrupts the response.
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'content-encoding',
];

// Upstream (SDLC backend) must connect + send response headers within these
// windows, or the request fails as SDLC_RUNTIME_UNAVAILABLE. bodyTimeout is
// unbounded so a legitimately long-lived SSE/download response already
// streaming is never cut off.
//
// Deliberately NOT using the global fetch dispatcher: undici's default
// dispatcher has hung indefinitely on plain `fetch()` calls elsewhere in this
// codebase (see vespaClient.ts, clawAgentService.ts) — same fix applies here,
// an explicit Agent with real timeouts instead of undici's defaults.
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;
const UPSTREAM_HEADERS_TIMEOUT_MS = 30_000;

const sdlcProxyDispatcher = new Agent({
  connectTimeout: UPSTREAM_CONNECT_TIMEOUT_MS,
  headersTimeout: UPSTREAM_HEADERS_TIMEOUT_MS,
  bodyTimeout: 0,
  keepAliveTimeout: 30_000,
  connections: 32,
});

function buildForwardHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (STRIPPED_INBOUND_HEADERS.includes(lowerKey) || HOP_BY_HOP_HEADERS.includes(lowerKey)) {
      continue;
    }
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    }
  }
  headers.set('x-s2s-key', config.internalS2sKey);
  // Real forwarding info, derived server-side (Express's trust-proxy aware
  // req.ip/req.hostname/req.protocol), not the client-supplied headers
  // stripped above.
  headers.set('x-forwarded-for', req.ip ?? '');
  headers.set('x-forwarded-host', req.hostname);
  headers.set('x-forwarded-proto', req.protocol);
  // Avoids relying on undici to transparently decompress a body while
  // leaving the stale Content-Encoding header on upstream.headers.
  headers.set('accept-encoding', 'identity');
  return headers;
}

/**
 * Express middleware factory: forwards the request to
 * `${config.sdlcRuntimeUrl}${req.originalUrl}`, preserving method, headers,
 * body, and streaming the response (status + headers + body) back verbatim.
 */
export function createSdlcProxy() {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!config.sdlcRuntimeUrl) {
      logger.error(`[sdlcProxy] SDLC_RUNTIME_URL not configured, cannot proxy ${req.method} ${req.originalUrl}`);
      res.status(501).json({ error: 'SDLC_RUNTIME_UNAVAILABLE', message: 'SDLC backend not configured' });
      return;
    }

    // Body has already been parsed by express.json()/urlencoded(), so the raw
    // bytes are gone by the time we get here — binary/multipart isn't
    // supported through this proxy. Fail fast instead of forwarding "{}".
    const inboundContentType = req.headers['content-type'] ?? '';
    if (/^multipart\/|^application\/octet-stream/i.test(inboundContentType)) {
      logger.error(`[sdlcProxy] ${req.method} ${req.originalUrl} has unsupported content-type "${inboundContentType}"`);
      res.status(415).json({ error: 'UNSUPPORTED_CONTENT_TYPE', message: 'Binary/multipart bodies are not supported through the SDLC proxy' });
      return;
    }

    const traceId = randomUUID();
    const targetUrl = `${config.sdlcRuntimeUrl}${req.originalUrl}`;
    const headers = buildForwardHeaders(req);
    headers.set('x-trace-id', traceId);

    const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;
    const body = hasBody ? JSON.stringify(req.body ?? {}) : undefined;
    if (hasBody) {
      headers.set('content-type', 'application/json');
    }

    // Client disconnect aborts the upstream request; connect/headers timeouts
    // are handled by sdlcProxyDispatcher itself (see above), not here.
    //
    // Deliberately res.on('close'), not req.on('close'): the request stream
    // fires 'close' as soon as its body is fully read (i.e. almost
    // immediately for any normal POST), long before the response is done —
    // using it here self-aborts nearly every proxied write instantly. res
    // only closes when the client actually disconnects or the response
    // finishes, so guard with writableEnded to ignore the normal-completion
    // case.
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const startedAt = Date.now();
    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
        signal: abortController.signal,
        // `dispatcher` is an undici extension not in the DOM RequestInit type.
        dispatcher: sdlcProxyDispatcher,
      } as unknown as RequestInit);

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });

      if (!upstream.body) {
        res.end();
      } else {
        await pipeline(
          Readable.fromWeb(upstream.body as import('stream/web').ReadableStream<Uint8Array>),
          res,
        );
      }

      logger.info(
        `[sdlcProxy] ${req.method} ${req.originalUrl} -> ${upstream.status} (${Date.now() - startedAt}ms) trace=${traceId}`
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        logger.info(`[sdlcProxy] ${req.method} ${req.originalUrl} aborted by client trace=${traceId}`);
        return;
      }

      // Undici timeout errors carry these codes; everything else (ECONNREFUSED,
      // socket errors, etc.) is logged the same way — all mean "unreachable"
      // from the caller's perspective.
      const code = (error as { code?: string; cause?: { code?: string } })?.code
        ?? (error as { cause?: { code?: string } })?.cause?.code;
      if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
        logger.error(`[sdlcProxy] ${req.method} ${req.originalUrl} upstream timed out (${code}) trace=${traceId}`);
      } else {
        logger.error(`[sdlcProxy] ${req.method} ${req.originalUrl} failed trace=${traceId}`, error);
      }

      if (!res.headersSent) {
        res.status(502).json({
          error: 'SDLC_RUNTIME_UNAVAILABLE',
          message: 'SDLC backend unavailable',
        });
      } else {
        // Response streaming had already started (e.g. mid-SSE) when the
        // upstream connection died — nothing more we can send, just end it.
        res.end();
      }
    }
  };
}

function extractFirstChannelId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const channelIds = (Array.isArray(b['channelIds']) && (b['channelIds'] as unknown[]).length
    ? b['channelIds']
    : b['channel_ids']) as unknown;
  return Array.isArray(channelIds) && typeof channelIds[0] === 'string'
    ? (channelIds[0] as string)
    : undefined;
}

// /api/xyne-ai gate: proxies to SDLC only the repository-scoped query;
// everything else falls through to next() (the local xyneAIRoutes) so
// normal Ask AI keeps working through an SDLC outage.
export function createSdlcAskAiGate() {
  const proxy = createSdlcProxy();
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'POST' || req.path !== '/') {
      next();
      return;
    }

    const channelId = extractFirstChannelId(req.body);
    if (!channelId) {
      next();
      return;
    }

    try {
      const repo = await db.repo.findFirst({ where: { channelId }, select: { id: true } });
      if (repo) {
        await proxy(req, res, next);
        return;
      }
    } catch (error) {
      logger.error('[sdlcAskAiGate] repo lookup failed, falling back to CORE', error);
    }

    next();
  };
}
