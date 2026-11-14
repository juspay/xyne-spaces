import { EventEmitter } from 'events';
import type { ClientManifestVersionEvent, SignedClientManifest } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getEncryptionProvider } from './provider';
import type { ClientEncryptionManifest } from './types';

/** Fallback lifetime of a cached manifest; the version poll normally invalidates first. */
const CACHE_TTL_MS = 60_000;
/** How often each backend pod asks the encryption service for the latest version. */
const VERSION_POLL_INTERVAL_MS = 10_000;
/** Tags are client-supplied, so bound what one pod caches and polls. */
const MAX_CACHED_TAGS = 32;
const MAX_WATCHED_TAGS = 8;

type CacheEntry = {
  manifest: ClientEncryptionManifest | null;
  /** Relayed to clients byte-for-byte; `null` while signing is not configured. */
  signed: SignedClientManifest | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
/** Last version seen per tag, by the poll or by a load. */
const knownVersions = new Map<string, number>();
const watchedTags = new Set<string>(['default']);
const versionEvents = new EventEmitter();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function remember(tag: string, entry: CacheEntry): void {
  if (!cache.has(tag) && cache.size >= MAX_CACHED_TAGS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(tag, entry);
  if (entry.manifest) {
    if (!knownVersions.has(tag)) knownVersions.set(tag, entry.manifest.version);
    if (watchedTags.size < MAX_WATCHED_TAGS) watchedTags.add(tag);
  }
}

/**
 * The unsigned manifest (for this backend's own checks) and the signed envelope (for
 * clients), fetched together once per tag however many requests are waiting. Signing
 * failures do not fail the load: clients then fall back to their stored copy.
 */
function load(tag: string): Promise<CacheEntry> {
  const cached = cache.get(tag);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);

  const pending = inFlight.get(tag);
  if (pending) return pending;

  const provider = getEncryptionProvider();
  const params = { tag, environment: config.env };
  const request = Promise.all([
    provider.getClientManifest(params),
    provider.getSignedClientManifest(params).catch((error) => {
      logger.warn('[encManifest] signed client manifest unavailable', {
        tag,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
  ])
    .then(([manifest, signed]) => {
      const entry = { manifest, signed, expiresAt: Date.now() + CACHE_TTL_MS };
      remember(tag, entry);
      return entry;
    })
    .finally(() => {
      inFlight.delete(tag);
    });

  inFlight.set(tag, request);
  return request;
}

/**
 * Latest client manifest for `tag` in this environment. Cached per tag, refreshed when
 * the version poll sees a new version (or after 60s), with in-flight dedupe. Used by the
 * per-request checks. Failures are not cached.
 */
export async function getLatestClientManifest(
  tag: string
): Promise<ClientEncryptionManifest | null> {
  return (await load(tag)).manifest;
}

/** Both halves of the cache entry, for the manifest route. */
export async function getLatestClientManifests(
  tag: string
): Promise<{ manifest: ClientEncryptionManifest | null; signed: SignedClientManifest | null }> {
  const { manifest, signed } = await load(tag);
  return { manifest, signed };
}

/** Last version this pod knows for `tag`, for the socket hello; no I/O. */
export function getKnownClientManifestVersion(tag: string): number | undefined {
  return knownVersions.get(tag);
}

/** Called with `{ tag, version }` whenever the poll sees the latest version change. */
export function onClientManifestVersionChange(
  listener: (event: ClientManifestVersionEvent) => void
): () => void {
  versionEvents.on('change', listener);
  return () => versionEvents.off('change', listener);
}

async function pollTag(tag: string): Promise<void> {
  const version = await getEncryptionProvider().getClientManifestVersion({
    tag,
    environment: config.env,
  });
  if (version === null) return;
  const previous = knownVersions.get(tag);
  if (previous === version) return;
  knownVersions.set(tag, version);
  cache.delete(tag);
  if (previous === undefined) return;
  // Load before announcing, so the clients that refetch are served from memory.
  await load(tag);
  logger.info('[encManifest] client manifest version changed', {
    tag,
    from: previous,
    to: version,
  });
  versionEvents.emit('change', { tag, version } satisfies ClientManifestVersionEvent);
}

async function pollOnce(): Promise<void> {
  await Promise.all(
    [...watchedTags].map((tag) =>
      pollTag(tag).catch((error) => {
        logger.warn('[encManifest] client manifest version poll failed', {
          tag,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    )
  );
}

/**
 * Each pod polls the encryption service (one tiny request per tag every 10s) and tells
 * its own sockets when the version changes. No cross-pod messaging: every pod notices
 * the change by itself within one interval.
 */
export function startClientManifestWatcher(): void {
  if (!config.enc.apiClientEncryptionEnabled || pollTimer) return;
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), VERSION_POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

export function stopClientManifestWatcher(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
