// GET|HEAD /objects/<bundle>/<object>: stream one object from the origin.
// nginx caches these responses; browser-facing Cache-Control and Content-Type
// are decided here so the cached copy already carries them.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';

import { cacheControlFor, contentTypeFor, type CacheMode } from '../contentType.js';
import { log } from '../log.js';
import { metrics } from '../metrics.js';
import type { ObjectInfo, Origin } from '../origin/index.js';

const CACHE_MODES = new Set<string>(['versioned', 'never', 'ttl']);

function parseKey(pathname: string): { bundle: string; object: string } | null {
  const rest = pathname.replace(/^\/objects\//, '');
  const slash = rest.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  const decode = (s: string): string => s.split('/').map(decodeURIComponent).join('/');
  let bundle: string;
  let object: string;
  try {
    bundle = decode(rest.slice(0, slash));
    object = decode(rest.slice(slash + 1));
  } catch {
    return null;
  }
  if (bundle === '' || object === '' || `${bundle}/${object}`.split('/').includes('..')) {
    return null;
  }
  return { bundle, object };
}

function responseHeaders(
  object: string,
  mode: CacheMode,
  info: ObjectInfo,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(object, info.contentType),
    'Cache-Control': cacheControlFor(mode, object),
  };
  if (info.etag) {
    headers['ETag'] = `"${info.etag}"`;
  }
  if (info.lastModified) {
    headers['Last-Modified'] = info.lastModified.toUTCString();
  }
  if (info.size !== undefined) {
    headers['Content-Length'] = String(info.size);
  }
  return headers;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string | undefined): boolean {
  if (!ifNoneMatch || !etag) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((s) => s.trim().replace(/^W\//, '').replace(/"/g, ''))
    .some((s) => s === '*' || s === etag);
}

export function makeObjectsHandler(
  origin: Origin,
): (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<void> {
  return async (req, res, pathname) => {
    const key = parseKey(pathname);
    if (!key) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('edge: invalid object key\n');
      return;
    }
    const objectKey = `${key.bundle}/${key.object}`;
    const modeHeader = req.headers['x-edge-cache-mode'];
    const mode = (
      typeof modeHeader === 'string' && CACHE_MODES.has(modeHeader) ? modeHeader : 'versioned'
    ) as CacheMode;
    const ifNoneMatch = req.headers['if-none-match'];

    try {
      if (req.method === 'HEAD' || ifNoneMatch) {
        const info = await origin.head(objectKey);
        if (!info) {
          metrics.originRequests.inc({ result: 'not_found' });
          res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        if (etagMatches(typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined, info.etag)) {
          metrics.originRequests.inc({ result: 'not_modified' });
          res.writeHead(304, responseHeaders(key.object, mode, info));
          res.end();
          return;
        }
        if (req.method === 'HEAD') {
          metrics.originRequests.inc({ result: 'ok' });
          res.writeHead(200, responseHeaders(key.object, mode, info));
          res.end();
          return;
        }
      }

      const read = await origin.get(objectKey);
      if (!read) {
        metrics.originRequests.inc({ result: 'not_found' });
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('edge: object not found\n');
        return;
      }
      res.writeHead(200, responseHeaders(key.object, mode, read.info));
      await pipeline(read.stream, res);
      metrics.originRequests.inc({ result: 'ok' });
    } catch (err) {
      metrics.originRequests.inc({ result: 'error' });
      log.error('origin fetch failed', { key: objectKey, err });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('edge: origin error\n');
      } else {
        res.destroy();
      }
    }
  };
}
