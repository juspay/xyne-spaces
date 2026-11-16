import { API_BASE_URL } from '../config.js';
import { Event } from '../logger/events.js';
import type { ClientEncryptionManifest, ClientManifestVersionEvent } from '../enc-contracts/manifest.js';
import { getCryptoLogger } from './crypto-logger.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
import { TRANSIT_TICKET_HEADER, type TransitKeyring } from './keyring.js';

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
/** Environment of the manifest a write was encrypted with ('production', 'playground', ...). */
export const CLIENT_MANIFEST_ENVIRONMENT_HEADER = 'x-enc-manifest-environment';

/** Upper bound of the random delay before refetching after a version announcement. */
const REFRESH_JITTER_MS = 30_000;
/** Upper bound after a prod <-> pre-prod move: short, it fits inside the switch overlay. */
const LANE_CHANGE_JITTER_MS = 3_000;

// Module-level store: the manifest is independent of the transit keyring, so it
// is kept here rather than in EncryptionConfig or key storage.
let currentManifest: ClientEncryptionManifest | null = null;
let inFlight: Promise<ClientEncryptionManifest | null> | null = null;
/** Decrypts the manifest, which the backend sends encrypted with the transit key. */
let keyring: TransitKeyring | null = null;

/** Latest version the backend announced over the socket, if newer than ours. */
let announced: ClientManifestVersionEvent | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** Set when the user was moved between lanes and the new lane's manifest is not loaded yet. */
let laneChangePending = false;

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

export function refreshClientManifest(tag = 'default'): Promise<ClientEncryptionManifest | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const headers: Record<string, string> = {};
    // Ask for the response to be encrypted under our current ticket.
    if (keyring) headers[TRANSIT_TICKET_HEADER] = (await keyring.current()).ticket;
    const response = await fetch(`${API_BASE_URL}/encryption-manifest?tag=${encodeURIComponent(tag)}`, {
      credentials: 'include',
      headers,
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
    laneChangePending = false;
    if (announced && !isBehind(announced)) announced = null;
  });

  return inFlight;
}

function isBehind(event: ClientManifestVersionEvent): boolean {
  const current = currentManifest;
  if (!current || current.tag !== event.tag) return true;
  // Another lane's announcement (the socket reconnected after a move): versions of
  // different environments are not comparable, so it is behind by definition.
  if (event.environment && current.environment !== event.environment) return true;
  return event.version > current.version;
}

function scheduleRefresh(tag: string, maxDelayMs: number): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshClientManifest(tag).catch(() => undefined);
  }, Math.random() * maxDelayMs);
}

/**
 * Socket handler for `enc_manifest_version` (sent on connect and when a new version is
 * published): refetch after a random 0–30 s delay if it is newer than ours.
 */
export function noteClientManifestVersion(event: ClientManifestVersionEvent): void {
  if (!event || typeof event.tag !== 'string' || typeof event.version !== 'number') return;
  if (allowedEnvironments && event.environment && !allowedEnvironments.includes(event.environment)) return;
  if (!isBehind(event)) return;
  announced = event;
  // A different lane means the user was moved: use the short window, not the long one.
  const laneChanged = !!event.environment && !!currentManifest && currentManifest.environment !== event.environment;
  if (refreshTimer && !laneChanged) return;
  scheduleRefresh(event.tag, laneChanged ? LANE_CHANGE_JITTER_MS : REFRESH_JITTER_MS);
}

/** The user was moved between prod and pre-prod: refetch the new lane's manifest within 0–3 s. */
export function noteClientManifestLaneChanged(tag = currentManifest?.tag ?? 'default'): void {
  laneChangePending = true;
  scheduleRefresh(tag, LANE_CHANGE_JITTER_MS);
}

/** Before a write: if a refetch is pending (new version or lane change), run it now. */
export async function refreshClientManifestIfStale(): Promise<void> {
  const pending = announced && isBehind(announced) ? announced : null;
  if (!pending && !laneChangePending) return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  await refreshClientManifest(pending?.tag ?? currentManifest?.tag ?? 'default').catch(() => undefined);
}

export function clearClientManifest(): void {
  currentManifest = null;
  keyring = null;
  announced = null;
  laneChangePending = false;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}
