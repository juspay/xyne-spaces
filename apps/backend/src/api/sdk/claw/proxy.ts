/**
 * `/api/sdk/v2/claw/api/*`: the claw-auth product API, relayed as the caller.
 *
 * Every allowed request is forwarded to claw-auth's `/claw/api/v1/*` with the
 * caller's own session rebuilt as a cookie (see `session.ts`), so claw-auth
 * authorizes it exactly as it would the same user in the dashboard. Nothing
 * here decides permission; `allowlist.ts` only decides which routes exist.
 *
 * Wire contract:
 * - Request: method, path, query string and body are passed through. JSON and
 *   form bodies were already parsed by the app and are re-encoded; any other
 *   body (multipart uploads) is still unread and is streamed through.
 * - Success: claw-auth's body is returned verbatim, usually `{ success, data, ... }`.
 *   Event streams and binary downloads are piped through as they arrive.
 * - Failure: claw-auth's `{ success: false, error, code }` becomes the SDK error
 *   envelope, with claw's `code` as `reason`.
 */

import { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { Agent } from 'undici';
import { getClawBaseUrl } from '@/services/clawAgentService';
import { SdkApiError, type ErrorCode } from '../errors';
import { handle } from '../handler';
import { isClawRouteAllowed } from './allowlist';
import { clawSession } from './session';

/**
 * No body timeout: an event stream or a slow generation can be quiet for minutes.
 * The caller hanging up is what ends a request, through the abort below.
 */
const clawProxyDispatcher = new Agent({
  headersTimeout: 120_000,
  bodyTimeout: 0,
  connectTimeout: 10_000,
});

/** Request headers that describe the body, forwarded as sent. Nothing else is. */
const FORWARDED_REQUEST_HEADERS = ['content-type', 'content-length', 'accept'] as const;

/** Response headers worth keeping on a non-JSON response. */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
] as const;

function requestBody(req: Request): string | Readable | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const type = req.headers['content-type'] ?? '';
  if (/\bjson\b/i.test(type)) return JSON.stringify(req.body ?? {});
  if (/application\/x-www-form-urlencoded/i.test(type)) {
    return new URLSearchParams(req.body as Record<string, string>).toString();
  }
  // Not parsed by the app, so the stream is still unread.
  return req.headers['content-length'] === '0' ? undefined : req;
}

function errorCode(status: number): ErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal';
  return 'validation_failed';
}

export async function upstreamError(upstream: globalThis.Response, path: string): Promise<SdkApiError> {
  const text = await upstream.text().catch(() => '');
  let message: string | undefined;
  let reason: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown };
    if (typeof body.error === 'string') message = body.error;
    else if (typeof body.message === 'string') message = body.message;
    if (typeof body.code === 'string') reason = body.code;
  } catch {
    // Not JSON: keep the status, drop the body.
  }
  return new SdkApiError(errorCode(upstream.status), message ?? `Claw request failed (${upstream.status}).`, {
    ...(reason ? { reason } : {}),
    cause: new Error(`claw-auth ${upstream.status} for ${path}: ${text.slice(0, 500)}`),
  });
}

/** Copy an upstream body to the client as it arrives, honouring backpressure. */
async function pipeBody(body: ReadableStream<Uint8Array>, res: Response, signal: AbortSignal): Promise<void> {
  const reader = body.getReader();
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && !res.writableEnded && !res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => {
          res.once('drain', resolve);
          res.once('close', resolve);
        });
      }
    }
  } catch (err) {
    // The caller left, which aborted the fetch: nothing to report to anyone.
    if (!signal.aborted) throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
    if (!res.writableEnded) res.end();
  }
}

/** Relay one request to claw-auth. `path` is relative to `/claw/api/v1`. */
async function relay(req: Request, res: Response, path: string): Promise<void> {
  req.sdkCall = { op: `${req.method} claw${path}`, kind: 'direct' };
  if (!isClawRouteAllowed(req.method, path)) {
    throw new SdkApiError('not_found', `Claw route ${req.method} ${path} is not available through the SDK.`);
  }

  const session = clawSession(req);
  const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  const url = `${getClawBaseUrl()}/claw/api/v1${path}${search}`;

  const headers: Record<string, string> = {
    cookie: session.cookie,
    'x-workspace-id': session.workspaceId,
  };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (req.apiRequestId) headers['x-request-id'] = req.apiRequestId;

  const body = requestBody(req);
  // A re-encoded body has its own length; the caller's would be wrong.
  if (typeof body === 'string') delete headers['content-length'];

  const abort = new AbortController();
  const onClose = (): void => {
    if (!res.writableFinished) abort.abort();
  };
  res.on('close', onClose);

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      ...(body === undefined
        ? {}
        : body instanceof Readable
          ? { body: Readable.toWeb(body) as ReadableStream, duplex: 'half' }
          : { body }),
      redirect: 'manual',
      signal: abort.signal,
      // `dispatcher` is an undici extension not in the DOM RequestInit type.
      dispatcher: clawProxyDispatcher,
    } as unknown as RequestInit);
  } catch (err) {
    res.off('close', onClose);
    if (abort.signal.aborted) return;
    throw new SdkApiError('internal', 'Claw is unreachable.', { cause: err });
  }

  try {
    if (upstream.status >= 400) throw await upstreamError(upstream, path);

    const type = upstream.headers.get('content-type') ?? '';

    if (/text\/event-stream/i.test(type)) {
      res.writeHead(upstream.status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Content-Encoding': 'none',
      });
      res.socket?.setNoDelay(true);
      res.flushHeaders();
      if (upstream.body) await pipeBody(upstream.body, res, abort.signal);
      else res.end();
      return;
    }

    if (upstream.status === 204 || !upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    if (/\bjson\b/i.test(type)) {
      const text = await upstream.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new SdkApiError('internal', 'Claw returned malformed JSON.', {
          cause: new Error(`claw-auth ${path}: ${text.slice(0, 200)}`),
        });
      }
      res.status(upstream.status).json(parsed);
      return;
    }

    // Binary or text: attachment downloads, thumbnails, exports.
    res.status(upstream.status);
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    await pipeBody(upstream.body, res, abort.signal);
  } finally {
    res.off('close', onClose);
  }
}

/** Mounted at `/claw/api` inside the v2 router. */
export function createClawProxyRouter(): Router {
  const router = Router();
  router.use(
    '/claw/api',
    handle(async (req, res) => {
      // Inside this mount `req.path` is what follows `/claw/api`.
      await relay(req, res, req.path);
    }),
  );
  return router;
}
