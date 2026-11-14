import { API_BASE_URL } from '../config.js';
import { Event } from '../logger/events.js';
import type {
  ClientEncryptionManifest,
  ClientManifestVersionEvent,
  SignedClientManifest,
  SignedClientManifestPayload,
} from '../enc-contracts/manifest.js';
import { getCryptoLogger } from './crypto-logger.js';
import { getTrustedManifestKeys } from './manifest-keys.js';
import { ManifestVerificationError, verifySignedClientManifest } from './manifest-verify.js';

// The manifest types are defined once, next to the contracts they are generated from.
export type {
  ClientManifestTransform,
  ClientManifestFieldRule,
  ClientManifestRule,
  ClientEncryptionManifest,
  PersistPolicy,
  ExtractionPolicy,
} from '../enc-contracts/manifest.js';

export const CLIENT_MANIFEST_VERSION_HEADER = 'x-enc-manifest-version';
export const CLIENT_MANIFEST_TAG_HEADER = 'x-enc-manifest-tag';
export const CLIENT_MANIFEST_STALE_CODE = 'ENC_MANIFEST_STALE';

/** Upper bound of the random delay before refetching after a version announcement. */
const REFRESH_JITTER_MS = 30_000;

/**
 * Where the signed envelope and the highest version seen are kept between app starts.
 * Only the signed envelope is stored, never the parsed manifest, so a copy edited on the
 * device fails verification on the next load. Defaults to localStorage (web, Electron)
 * and to memory where there is none (React Native, Node).
 */
export interface ClientManifestStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

function defaultStorage(): ClientManifestStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const probe = '__xyne_enc_manifest_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    // Storage disabled (private mode, sandboxed iframe): fall through to memory.
  }
  const memory = new Map<string, string>();
  return {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
  };
}

let storage: ClientManifestStorage | null = null;

function getStorage(): ClientManifestStorage {
  storage ??= defaultStorage();
  return storage;
}

export function setClientManifestStorage(next: ClientManifestStorage): void {
  storage = next;
}

const envelopeKey = (tag: string) => `xyne.enc.manifest.envelope:${tag}`;
const highestKey = (environment: string, tag: string) => `xyne.enc.manifest.highest:${environment}:${tag}`;

// Module-level store: the manifest is independent of the long-lived session key, so it
// is kept here rather than in EncryptionConfig or key storage.
let currentManifest: ClientEncryptionManifest | null = null;
let inFlight: Promise<ClientEncryptionManifest | null> | null = null;
let warnedUnsigned = false;

/** Latest version the backend announced over the socket, if newer than ours. */
let announced: ClientManifestVersionEvent | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function getClientManifest(): ClientEncryptionManifest | null {
  return currentManifest;
}

function logRejected(reason: string, extra: Record<string, unknown> = {}): void {
  getCryptoLogger().warn(Event.ENCRYPTION_MANIFEST_REJECTED, {
    message: `[encryptionlog] Client manifest rejected: ${reason}`,
    reason,
    ...extra,
  });
}

async function readHighest(environment: string, tag: string): Promise<number> {
  const raw = await getStorage().getItem(highestKey(environment, tag));
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) ? n : 0;
}

/**
 * Verifies `envelope` and checks it is not older than a version this device already
 * accepted (an old but validly signed manifest is the replay a compromised relay would
 * try). On success the envelope and the new high-water mark are stored.
 */
async function acceptEnvelope(
  envelope: SignedClientManifest,
  tag: string,
): Promise<SignedClientManifestPayload> {
  const payload = await verifySignedClientManifest(envelope, tag);
  const highest = await readHighest(payload.environment, tag);
  if (payload.version < highest) {
    throw new ManifestVerificationError(
      'rolled_back',
      `Manifest version ${payload.version} is older than version ${highest} already seen`,
    );
  }
  const store = getStorage();
  await store.setItem(envelopeKey(tag), JSON.stringify(envelope));
  if (payload.version > highest) {
    await store.setItem(highestKey(payload.environment, tag), String(payload.version));
  }
  getCryptoLogger().info(Event.ENCRYPTION_MANIFEST_ACCEPTED, {
    message: '[encryptionlog] Client manifest verified',
    kid: envelope.kid,
    version: payload.version,
    tag,
    environment: payload.environment,
  });
  return payload;
}

/** The stored envelope, re-verified (signature, expiry, rollback), or null. */
async function restoreStoredManifest(tag: string): Promise<SignedClientManifestPayload | null> {
  try {
    const raw = await getStorage().getItem(envelopeKey(tag));
    if (!raw) return null;
    return await acceptEnvelope(JSON.parse(raw) as SignedClientManifest, tag);
  } catch (error) {
    logRejected(error instanceof ManifestVerificationError ? error.reason : 'stored_unreadable', {
      source: 'storage',
    });
    return null;
  }
}

/**
 * Which manifest to use from a server response. Until trusted keys are built into the
 * app (rollout), the unsigned manifest is used as before. Once any key is trusted, only
 * a verified envelope counts; otherwise the last verified stored copy, or none, in which
 * case requests fall back to encrypting every field (over-encryption is the safe side).
 */
async function resolveManifest(
  data: { clientManifest?: ClientEncryptionManifest | null; signedManifest?: SignedClientManifest | null },
  tag: string,
): Promise<ClientEncryptionManifest | null> {
  if (getTrustedManifestKeys().length === 0) {
    if (!warnedUnsigned) {
      warnedUnsigned = true;
      getCryptoLogger().warn(Event.ENCRYPTION_MANIFEST_REJECTED, {
        message: '[encryptionlog] No trusted manifest keys configured; using the unsigned manifest',
        reason: 'unsigned_rollout',
      });
    }
    return data.clientManifest ?? null;
  }

  if (!data.signedManifest) {
    logRejected('missing_signature', { source: 'server' });
    return restoreStoredManifest(tag);
  }

  try {
    return await acceptEnvelope(data.signedManifest, tag);
  } catch (error) {
    logRejected(error instanceof ManifestVerificationError ? error.reason : 'verify_failed', {
      source: 'server',
      kid: data.signedManifest.kid,
      error: error instanceof Error ? error.message : String(error),
    });
    return restoreStoredManifest(tag);
  }
}

export function refreshClientManifest(tag = 'default'): Promise<ClientEncryptionManifest | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/encryption-manifest?tag=${encodeURIComponent(tag)}`, {
        credentials: 'include',
      });
    } catch (error) {
      // Offline: keep working from the last verified copy, if it has not expired.
      const restored = getTrustedManifestKeys().length > 0 ? await restoreStoredManifest(tag) : null;
      if (restored) {
        currentManifest = restored;
        return currentManifest;
      }
      throw error;
    }

    if (response.status === 404) {
      currentManifest = null;
      return null;
    }

    if (!response.ok) {
      throw new Error(`Client encryption manifest request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      clientManifest?: ClientEncryptionManifest | null;
      signedManifest?: SignedClientManifest | null;
    };
    currentManifest = await resolveManifest(data, tag);
    return currentManifest;
  })().finally(() => {
    inFlight = null;
    if (announced && currentManifest && announced.tag === currentManifest.tag && announced.version <= currentManifest.version) {
      announced = null;
    }
  });

  return inFlight;
}

function isBehind(event: ClientManifestVersionEvent): boolean {
  const current = currentManifest;
  return !current || current.tag !== event.tag || event.version > current.version;
}

/**
 * Socket handler for `enc_manifest_version`. Sent on every connect and whenever a new
 * version is published. If it is newer than ours, refetch after a random 0–30 s delay so
 * that thousands of clients do not all refetch in the same instant.
 */
export function noteClientManifestVersion(event: ClientManifestVersionEvent): void {
  if (!event || typeof event.tag !== 'string' || typeof event.version !== 'number') return;
  if (!isBehind(event)) return;
  announced = event;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const pending = announced;
    if (!pending || !isBehind(pending)) return;
    void refreshClientManifest(pending.tag).catch(() => undefined);
  }, Math.random() * REFRESH_JITTER_MS);
}

/**
 * Before a write: if a newer version was announced and its jittered refetch has not run
 * yet, refetch now so the write is encrypted with the latest rules.
 */
export async function refreshClientManifestIfStale(): Promise<void> {
  const pending = announced;
  if (!pending || !isBehind(pending)) return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  await refreshClientManifest(pending.tag).catch(() => undefined);
}

export function clearClientManifest(): void {
  currentManifest = null;
  announced = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  // The stored envelope and the highest-version counter are kept on purpose: they are
  // not secret, and the counter is what stops an older manifest being replayed later.
}
