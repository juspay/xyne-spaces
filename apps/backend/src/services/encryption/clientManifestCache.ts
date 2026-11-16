import { EventEmitter } from 'events';
import type { ClientManifestVersionEvent } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { defaultManifestEnvironment, type ClientManifestEnvironment } from './manifestEnvironment';
import { getEncryptionProvider } from './provider';
import type { ClientEncryptionManifest } from './types';

/** Fallback lifetime of a cached manifest; the version poll normally invalidates first. */
const CACHE_TTL_MS = 60_000;
/** How often each backend pod asks the encryption service for the latest version. */
const VERSION_POLL_INTERVAL_MS = 10_000;
/** Tags are client-supplied, so bound what one pod caches and polls. */
const MAX_CACHED_ENTRIES = 32;
const MAX_WATCHED_ENTRIES = 8;

type CacheEntry = {
  manifest: ClientEncryptionManifest | null;
  expiresAt: number;
};

/** What is cached, polled and announced: one manifest per (environment, tag). */
type ManifestKey = { environment: ClientManifestEnvironment; tag: string };

const keyOf = ({ environment, tag }: ManifestKey): string => `${environment}\u0000${tag}`;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
/** Last version seen per (environment, tag), by the poll or by a load. */
const knownVersions = new Map<string, number>();
/**
 * What the poll checks. There is no list of environments to configure: an (environment,
 * tag) is watched from the first time a request asks for it and the encryption service has
 * a manifest for it, so the production cluster ends up polling 'production' and
 * 'playground', a sandbox deployment 'sandbox', and so on.
 */
const initialKey: ManifestKey = { environment: defaultManifestEnvironment(), tag: 'default' };
const watched = new Map<string, ManifestKey>([[keyOf(initialKey), initialKey]]);
const versionEvents = new EventEmitter();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function remember(key: ManifestKey, entry: CacheEntry): void {
  const k = keyOf(key);
  if (!cache.has(k) && cache.size >= MAX_CACHED_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, entry);
  if (entry.manifest) {
    if (!knownVersions.has(k)) knownVersions.set(k, entry.manifest.version);
    if (watched.size < MAX_WATCHED_ENTRIES) watched.set(k, key);
  }
}

/** The manifest for (environment, tag), fetched once however many requests are waiting. */
function load(key: ManifestKey): Promise<CacheEntry> {
  const k = keyOf(key);
  const cached = cache.get(k);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);

  const pending = inFlight.get(k);
  if (pending) return pending;

  const request = getEncryptionProvider()
    .getClientManifest(key)
    .then((manifest) => {
      const entry = { manifest, expiresAt: Date.now() + CACHE_TTL_MS };
      remember(key, entry);
      return entry;
    })
    .finally(() => {
      inFlight.delete(k);
    });

  inFlight.set(k, request);
  return request;
}

/**
 * Latest client manifest for `tag` in `environment` (default: from NODE_ENV). Cached, refreshed when the version poll sees a new
 * version (or after 60s), with in-flight dedupe. Used by the per-request checks; pass the
 * request's environment (`manifestEnvironmentForRequest`) so pre-prod requests are checked
 * against the pre-prod manifest. Failures are not cached.
 */
export async function getLatestClientManifest(
  tag: string,
  environment: ClientManifestEnvironment = defaultManifestEnvironment()
): Promise<ClientEncryptionManifest | null> {
  return (await load({ environment, tag })).manifest;
}

/** Last version this pod knows for (environment, tag), for the socket hello; no I/O. */
export function getKnownClientManifestVersion(
  tag: string,
  environment: ClientManifestEnvironment
): number | undefined {
  return knownVersions.get(keyOf({ environment, tag }));
}

/** Called with `{ tag, environment, version }` whenever a polled version changes. */
export function onClientManifestVersionChange(
  listener: (event: ClientManifestVersionEvent) => void
): () => void {
  versionEvents.on('change', listener);
  return () => versionEvents.off('change', listener);
}

async function poll(key: ManifestKey): Promise<void> {
  const version = await getEncryptionProvider().getClientManifestVersion(key);
  if (version === null) return;
  const k = keyOf(key);
  const previous = knownVersions.get(k);
  if (previous === version) return;
  knownVersions.set(k, version);
  cache.delete(k);
  if (previous === undefined) return;
  // Load before announcing, so the clients that refetch are served from memory.
  await load(key);
  logger.info('[encManifest] client manifest version changed', {
    ...key,
    from: previous,
    to: version,
  });
  versionEvents.emit('change', { ...key, version } satisfies ClientManifestVersionEvent);
}

async function pollOnce(): Promise<void> {
  await Promise.all(
    [...watched.values()].map((key) =>
      poll(key).catch((error) => {
        logger.warn('[encManifest] client manifest version poll failed', {
          ...key,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    )
  );
}

/**
 * Each pod polls the encryption service (one tiny request per environment and tag every
 * 10s) and tells its own sockets when a version changes. No cross-pod messaging: every pod
 * notices the change by itself within one interval. Either A/B side may serve either lane,
 * so a production pod polls 'production' and 'playground' once both have been requested.
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
