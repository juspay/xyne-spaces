/**
 * Generic proxy for SDLC traffic: main (CORE role) forwards the request
 * verbatim to the private SDLC-role backend at SDLC_RUNTIME_URL, using the
 * original path, and streams the response straight back — one code path for
 * plain JSON, SSE, and downloads. Main's own auth middleware has already run
 * by the time this executes; the SDLC backend re-checks S2S + auth itself.
 */
import type { NextFunction, Request, Response } from 'express';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

// Headers a client should never be able to spoof — always server-set below.
const STRIPPED_INBOUND_HEADERS = ['x-s2s-key', 'x-trace-id'];

// Hop-by-hop / connection-specific headers that must not be replayed verbatim
// in either direction.
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
];

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
  return headers;
}

/**
 * Express middleware factory: forwards the request to
 * `${config.sdlcRuntimeUrl}${req.originalUrl}`, preserving method, headers,
 * body, and streaming the response (status + headers + body) back verbatim.
 */
export function createSdlcProxy() {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const traceId = randomUUID();
    const targetUrl = `${config.sdlcRuntimeUrl}${req.originalUrl}`;
    const headers = buildForwardHeaders(req);
    headers.set('x-trace-id', traceId);

    // Body has already been parsed by the global express.json() middleware,
    // so the raw stream is gone — re-serialize instead of piping req itself.
    const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;
    const body = hasBody ? JSON.stringify(req.body ?? {}) : undefined;
    if (hasBody) {
      headers.set('content-type', 'application/json');
    }

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const startedAt = Date.now();
    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
        signal: abortController.signal,
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });

      if (!upstream.body) {
        res.end();
      } else {
        Readable.fromWeb(upstream.body as import('stream/web').ReadableStream<Uint8Array>).pipe(res);
      }

      logger.info(
        `[sdlcProxy] ${req.method} ${req.originalUrl} -> ${upstream.status} (${Date.now() - startedAt}ms) trace=${traceId}`
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        logger.info(`[sdlcProxy] ${req.method} ${req.originalUrl} aborted by client trace=${traceId}`);
        return;
      }
      logger.error(`[sdlcProxy] ${req.method} ${req.originalUrl} failed trace=${traceId}`, error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'SDLC backend unavailable' });
      }
    }
  };
}
