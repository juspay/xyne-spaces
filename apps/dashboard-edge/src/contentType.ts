// Response header policy for objects served to browsers. gsutil guesses most
// content types, but .mjs and friends come back as octet-stream and the
// bundle is ours, so types are decided here by extension.

export type CacheMode = 'versioned' | 'never' | 'ttl';

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  onnx: 'application/octet-stream',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  zip: 'application/zip',
};

const LONG_LIVED = new Set([
  'js',
  'mjs',
  'css',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'svg',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'wasm',
  'onnx',
  'mp3',
  'mp4',
  'webm',
]);

export const NO_CACHE = 'no-cache, no-store, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=300';

export function extensionOf(object: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(object);
  return match?.[1]?.toLowerCase() ?? '';
}

/** True when the path has no extension, i.e. a client-side route. */
export function isRouteLike(object: string): boolean {
  return extensionOf(object) === '';
}

export function contentTypeFor(object: string, fallback: string | undefined): string {
  return CONTENT_TYPES[extensionOf(object)] ?? fallback ?? 'application/octet-stream';
}

/** Browser-facing Cache-Control. The edge's own cache is keyed, not timed. */
export function cacheControlFor(mode: CacheMode, object: string): string {
  if (mode === 'never') {
    return NO_CACHE;
  }
  const ext = extensionOf(object);
  if (
    ext === 'html' ||
    object === 'sw.js' ||
    object === 'version.json' ||
    object.startsWith('releases/')
  ) {
    return NO_CACHE;
  }
  if (LONG_LIVED.has(ext)) {
    return IMMUTABLE;
  }
  return SHORT;
}
