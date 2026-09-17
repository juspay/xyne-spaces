// GET|HEAD /objects/<bundle>/<object>: stream one object from the origin.
// nginx caches these responses; browser-facing Cache-Control and Content-Type
// are decided here so the cached copy already carries them.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';

import { cacheControlFor, contentTypeFor, isRouteLike, type CacheMode } from '../contentType.js';
import { log } from '../log.js';
import { metrics } from '../metrics.js';
import type { ObjectInfo, ObjectRead, Origin } from '../origin/index.js';
import type { RulesStore } from '../rules/store.js';

const CACHE_MODES = new Set<string>(['versioned', 'never', 'ttl']);
const FALLBACK_PROBES = 10;
const MISSING_TTL_MS = 60_000;
const missing = new Map<string, number>();

function knownMissing(key: string): boolean {
  const until = missing.get(key);
  if (until === undefined) {
    return false;
  }
  if (until < Date.now()) {
    missing.delete(key);
    return false;
  }
  return true;
}

function rememberMissing(key: string): void {
  if (missing.size > 10_000) {
    missing.clear();
  }
  missing.set(key, Date.now() + MISSING_TTL_MS);
}

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
    'Accept-Ranges': 'bytes',
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

async function findElsewhere(
  origin: Origin,
  store: RulesStore,
  ruleId: string,
  bundle: string,
  object: string,
): Promise<{ bundle: string; read: ObjectRead } | null> {
  if (isRouteLike(object) || object === 'index.html') {
    return null;
  }
  const candidates = (await store.fallbackBundles(ruleId, bundle)).slice(0, FALLBACK_PROBES);
  for (const candidate of candidates) {
    const key = `${candidate}/${object}`;
    if (knownMissing(key)) {
      continue;
    }
    const read = await origin.get(key);
    if (read) {
      return { bundle: candidate, read };
    }
    rememberMissing(key);
  }
  return null;
}

export function makeObjectsHandler(
  origin: Origin,
  store: RulesStore,
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
    const ruleHeader = req.headers['x-edge-rule'];
    const ruleId = typeof ruleHeader === 'string' ? ruleHeader : '';

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

      let read = await origin.get(objectKey);
      let servedFrom = key.bundle;
      if (!read && ruleId !== '') {
        const found = await findElsewhere(origin, store, ruleId, key.bundle, key.object);
        if (found) {
          read = found.read;
          servedFrom = found.bundle;
          log.info('asset served from another bundle', {
            rule: ruleId,
            object: key.object,
            requested: key.bundle,
            served: servedFrom,
          });
        }
      }
      if (!read) {
        metrics.originRequests.inc({ result: 'not_found' });
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('edge: object not found\n');
        return;
      }
      const headers = responseHeaders(key.object, mode, read.info);
      if (servedFrom !== key.bundle) {
        headers['X-Edge-Served-From'] = servedFrom;
      }
      res.writeHead(200, headers);
      await pipeline(read.stream, res);
      metrics.originRequests.inc({ result: servedFrom === key.bundle ? 'ok' : 'fallback' });
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
