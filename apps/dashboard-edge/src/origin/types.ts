import type { ObjectInfo, ObjectRead } from '@xyne/storage';

export type { ObjectInfo, ObjectRead };

/** Where bundles live. One object key is "<bundle>/<object>". */
export interface Origin {
  kind: string;
  describe(): Record<string, unknown>;
  /** Metadata for one object, or null when it does not exist. Errors propagate. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Stream one object with its metadata, or null when it does not exist. Errors propagate. */
  get(key: string): Promise<ObjectRead | null>;
}

/** Short stable fingerprint of an object at the origin, for the cache key. */
export function fingerprintOf(info: ObjectInfo): string {
  const raw = info.etag ?? `${info.lastModified?.toISOString() ?? ''}|${info.size ?? ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // FNV-1a over the raw value plus its length keeps the key short and stable.
  return `${hash.toString(16).padStart(8, '0')}${(raw.length & 0xffff).toString(16).padStart(4, '0')}`;
}
