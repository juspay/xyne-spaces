import type { ExtractorName } from './extractors.js';

export type ClientManifestTransform = 'NONE' | 'MASTER_DEK';

export interface ClientManifestFieldRule {
  client: boolean;
  transform: ClientManifestTransform;
  storage: ClientManifestTransform;
}

/** Persist all of an extractor's output, none of it, or only these sub-paths (e.g. "pr"). */
export type PersistPolicy = true | false | readonly string[];

/** Extractors the encryption service runs for a rule, keyed by name; absent or {} = none. */
export type ExtractionPolicy = Partial<Record<ExtractorName, { persist: PersistPolicy }>>;

export interface ClientManifestRule {
  type: 'REQUEST' | 'MUTATOR';
  value: string;
  revision: number;
  fields: Record<string, ClientManifestFieldRule>;
  extractionPolicy?: ExtractionPolicy;
}

export interface ClientEncryptionManifest {
  schemaKey: string;
  version: number;
  tag: string;
  environment: string;
  rules: ClientManifestRule[];
}

/**
 * The manifest as the encryption service signs it. The backend relays this envelope
 * unchanged; clients verify `sig` over the exact `payload` bytes with a pinned public key
 * (picked by `kid`) before parsing it. `tag`, `environment` and `version` outside the
 * payload are unsigned hints for caches; clients trust only the verified payload.
 */
export interface SignedClientManifest {
  kid: string;
  /** ECDSA P-256 / SHA-256, raw 64-byte `r‖s` signature (as in JWS ES256). */
  alg: 'ES256';
  /** base64 of the UTF-8 JSON of a `SignedClientManifestPayload`. */
  payload: string;
  /** base64 of the signature over the decoded `payload` bytes. */
  sig: string;
  tag: string;
  environment: string;
  version: number;
}

/** What the signature covers: the manifest plus its validity window (ISO-8601). */
export interface SignedClientManifestPayload extends ClientEncryptionManifest {
  issuedAt: string;
  expiresAt: string;
}

/** Socket.IO event the backend sends on connect and whenever the latest version changes. */
export const CLIENT_MANIFEST_VERSION_EVENT = 'enc_manifest_version';

export interface ClientManifestVersionEvent {
  tag: string;
  version: number;
}
