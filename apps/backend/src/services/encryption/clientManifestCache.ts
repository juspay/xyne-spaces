import { EventEmitter } from 'events';
import type { ClientManifestVersionEvent } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { defaultManifestEnvironment, type ClientManifestEnvironment } from './manifestEnvironment';
import { getEncryptionProvider } from './provider';

/** How often each backend pod asks the encryption service for the latest version. */
const VERSION_POLL_INTERVAL_MS = 10_000;
/** Tags are client-supplied, so bound what one pod polls. */
const MAX_WATCHED_ENTRIES = 8;

/** What is polled and announced: one manifest per (environment, tag). */
type ManifestKey = { environment: ClientManifestEnvironment; tag: string };

const keyOf = ({ environment, tag }: ManifestKey): string => `${environment}\u0000${tag}`;

/** Last version the poll saw per (environment, tag). */
const knownVersions = new Map<string, number>();
/**
 * What the poll checks. There is no list of environments to configure: an (environment,
 * tag) is watched from the first time a socket on that lane asks for its version, so the
 * production cluster ends up polling 'production' and 'playground', a sandbox deployment
 * 'sandbox', and so on.
 */
const initialKey: ManifestKey = { environment: defaultManifestEnvironment(), tag: 'default' };
const watched = new Map<string, ManifestKey>([[keyOf(initialKey), initialKey]]);
const versionEvents = new EventEmitter();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function watch(key: ManifestKey): void {
  const k = keyOf(key);
  if (!watched.has(k) && watched.size < MAX_WATCHED_ENTRIES) watched.set(k, key);
}

/**
 * Last version this pod knows for (environment, tag), for the socket hello; no I/O. Starts
 * watching it, so later changes reach that lane's sockets.
 */
export function getKnownClientManifestVersion(
  tag: string,
  environment: ClientManifestEnvironment
): number | undefined {
  watch({ environment, tag });
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
  if (previous === undefined) return;
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
