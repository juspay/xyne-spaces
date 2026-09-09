// Plain HTTP(S) origin: any server exposing <STORAGE_ENDPOINT>/<bundle>/<object>.
// Useful on-prem (an nginx, a MinIO public bucket, an internal file server).
import { Readable } from 'node:stream';

import type { Config } from '../config.js';
import type { ObjectInfo, ObjectRead, Origin } from './types.js';

function infoFromHeaders(headers: Headers): ObjectInfo {
  const info: ObjectInfo = {};
  const length = headers.get('content-length');
  if (length !== null && length !== '') {
    info.size = Number(length);
  }
  const type = headers.get('content-type');
  if (type) {
    info.contentType = type;
  }
  const etag = headers.get('etag');
  if (etag) {
    info.etag = etag.replace(/^W\//, '').replace(/"/g, '');
  }
  const modified = headers.get('last-modified');
  if (modified) {
    info.lastModified = new Date(modified);
  }
  return info;
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function createHttpOrigin(cfg: Config['storage']): Origin {
  const base = cfg.endpoint as string;
  const headers: Record<string, string> = { 'user-agent': 'xyne-dashboard-edge' };
  if (cfg.authHeader) {
    headers.authorization = cfg.authHeader;
  }
  const urlFor = (key: string): string => `${base}/${encodeKey(key)}`;

  return {
    kind: 'http',
    describe: () => ({
      backend: 'http',
      endpoint: base,
      auth: cfg.authHeader ? 'static-header' : 'none',
    }),
    async head(key: string): Promise<ObjectInfo | null> {
      const res = await fetch(urlFor(key), { method: 'HEAD', headers });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`origin HEAD ${key} returned ${res.status}`);
      }
      return infoFromHeaders(res.headers);
    },
    async get(key: string): Promise<ObjectRead | null> {
      const res = await fetch(urlFor(key), { method: 'GET', headers });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        throw new Error(`origin GET ${key} returned ${res.status}`);
      }
      return {
        info: infoFromHeaders(res.headers),
        stream: Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      };
    },
  };
}
