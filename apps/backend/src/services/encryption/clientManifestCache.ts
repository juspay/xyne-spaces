import { config } from '@/config/env';
import { getEncryptionProvider } from './provider';
import type { ClientEncryptionManifest } from './types';

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  manifest: ClientEncryptionManifest | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ClientEncryptionManifest | null>>();

/**
 * Latest client manifest for `tag` in this environment, cached per tag for 60s with
 * in-flight dedupe. Used by the per-request version check; the manifest route reads the
 * provider directly so clients always get fresh data. Failures are not cached.
 */
export function getLatestClientManifest(tag: string): Promise<ClientEncryptionManifest | null> {
  const cached = cache.get(tag);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.manifest);

  const pending = inFlight.get(tag);
  if (pending) return pending;

  const request = getEncryptionProvider()
    .getClientManifest({ tag, environment: config.env })
    .then((manifest) => {
      cache.set(tag, { manifest, expiresAt: Date.now() + CACHE_TTL_MS });
      return manifest;
    })
    .finally(() => {
      inFlight.delete(tag);
    });

  inFlight.set(tag, request);
  return request;
}
