import { API_BASE_URL } from '../config.js';
import { Event } from '../logger/events.js';
import type { ClientEncryptionManifest } from '../enc-contracts/manifest.js';
import { getCryptoLogger } from './crypto-logger.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
import type { TransitKeyring } from './keyring.js';

// The manifest types are defined once, next to the contracts they are generated from.
export type {
  ClientManifestTransform,
  ClientManifestFieldRule,
  ClientManifestRule,
  ClientEncryptionManifest,
  PersistPolicy,
  ExtractionPolicy,
} from '../enc-contracts/manifest.js';

export const CLIENT_MANIFEST_STALE_CODE = 'ENC_MANIFEST_STALE';

// Module-level store: the manifest is independent of the transit keyring, so it
// is kept here rather than in EncryptionConfig or key storage.
let currentManifest: ClientEncryptionManifest | null = null;
let inFlight: Promise<ClientEncryptionManifest | null> | null = null;
/** Decrypts the manifest, which the backend sends encrypted with the transit key. */
let keyring: TransitKeyring | null = null;

/**
 * Environments this build accepts a manifest for: production builds 'production' and
 * 'playground' (the server picks the lane per request), sandbox only 'sandbox', local only
 * 'development'. `null` = any.
 */
let allowedEnvironments: readonly string[] | null = null;

export function setAllowedManifestEnvironments(environments: readonly string[] | null): void {
  allowedEnvironments = environments && environments.length > 0 ? [...environments] : null;
}

/** The keyring the manifest response is decrypted with; set at bootstrap. */
export function setClientManifestKeyring(next: TransitKeyring | null): void {
  keyring = next;
}

export function getClientManifest(): ClientEncryptionManifest | null {
  return currentManifest;
}

function isManifest(value: unknown): value is ClientEncryptionManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.version === 'number' &&
    typeof m.tag === 'string' &&
    typeof m.environment === 'string' &&
    Array.isArray(m.rules)
  );
}

/** `clientManifest` arrives as a JSON string, transit-encrypted when encryption is on. */
async function parseManifest(raw: unknown): Promise<ClientEncryptionManifest | null> {
  if (typeof raw !== 'string') return null;
  let json = raw;
  if (isEncryptedField(raw)) {
    if (!keyring) throw new Error('Client manifest is encrypted but no transit keyring is set');
    json = await decryptField(raw, keyring);
  }
  const manifest: unknown = JSON.parse(json);
  if (!isManifest(manifest)) throw new Error('Client manifest response is malformed');
  if (allowedEnvironments && !allowedEnvironments.includes(manifest.environment)) {
    getCryptoLogger().warn(Event.ENCRYPTION_MANIFEST_REJECTED, {
      message: `[encryptionlog] Client manifest for "${manifest.environment}" not accepted by this build`,
      reason: 'wrong_environment',
    });
    return null;
  }
  return manifest;
}

export function refreshClientManifest(): Promise<ClientEncryptionManifest | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Encrypted for the transit key registered for this session, which the server looks up.
    const response = await fetch(`${API_BASE_URL}/encryption-manifest`, {
      credentials: 'include',
    });

    if (response.status === 404) {
      currentManifest = null;
      return null;
    }

    if (!response.ok) {
      throw new Error(`Client encryption manifest request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { clientManifest?: unknown };
    currentManifest = await parseManifest(data.clientManifest);
    return currentManifest;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Waits between manifest refetches after a 409, about 11.5 s in all. */
const MANIFEST_REFETCH_DELAYS_MS = [0, 500, 1000, 2000, 4000, 4000];

/**
 * Refetches until the manifest is the version and environment the server asked for (any
 * freshly fetched manifest when neither is given). Shared by the REST retry and the Zero
 * mutation retry after ENC_MANIFEST_STALE.
 */
export async function refetchClientManifest(version?: number, environment?: string): Promise<boolean> {
  for (const delay of MANIFEST_REFETCH_DELAYS_MS) {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    const manifest = await refreshClientManifest().catch(() => undefined);
    // 404 or a wrong-environment manifest: retrying will not change it.
    if (manifest === null) return false;
    if (
      manifest &&
      (version === undefined || manifest.version === version) &&
      (environment === undefined || manifest.environment === environment)
    ) {
      return true;
    }
  }
  return false;
}

export function clearClientManifest(): void {
  currentManifest = null;
  keyring = null;
}
