import { API_BASE_URL } from '../config.js';

export type ClientManifestTransform = 'NONE' | 'MASTER_DEK';

export interface ClientManifestFieldRule {
  client: boolean;
  transform: ClientManifestTransform;
  storage: ClientManifestTransform;
}

export interface ClientManifestRule {
  type: 'REQUEST' | 'MUTATOR';
  value: string;
  revision: number;
  fields: Record<string, ClientManifestFieldRule>;
}

export interface ClientEncryptionManifest {
  schemaKey: string;
  version: number;
  tag: string;
  environment: string;
  rules: ClientManifestRule[];
}

export const CLIENT_MANIFEST_VERSION_HEADER = 'x-enc-manifest-version';
export const CLIENT_MANIFEST_TAG_HEADER = 'x-enc-manifest-tag';
export const CLIENT_MANIFEST_STALE_CODE = 'ENC_MANIFEST_STALE';

// Module-level store: the manifest is independent of the long-lived session key, so it
// is kept here rather than in EncryptionConfig or key storage.
let currentManifest: ClientEncryptionManifest | null = null;
let inFlight: Promise<ClientEncryptionManifest | null> | null = null;

export function getClientManifest(): ClientEncryptionManifest | null {
  return currentManifest;
}

export function refreshClientManifest(tag = 'default'): Promise<ClientEncryptionManifest | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const response = await fetch(
      `${API_BASE_URL}/encryption-manifest?tag=${encodeURIComponent(tag)}`,
      { credentials: 'include' },
    );

    if (response.status === 404) {
      currentManifest = null;
      return null;
    }

    if (!response.ok) {
      throw new Error(`Client encryption manifest request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { clientManifest?: ClientEncryptionManifest | null };
    currentManifest = data.clientManifest ?? null;
    return currentManifest;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function clearClientManifest(): void {
  currentManifest = null;
}
