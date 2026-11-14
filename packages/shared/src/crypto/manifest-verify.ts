import type {
  SignedClientManifest,
  SignedClientManifestPayload,
} from '../enc-contracts/manifest.js';
import { findTrustedManifestKey } from './manifest-keys.js';

/** Clock skew tolerated on `expiresAt`, for devices whose clock runs a little behind. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export type ManifestRejectReason =
  | 'unknown_kid'
  | 'unsupported_alg'
  | 'bad_signature'
  | 'malformed_payload'
  | 'wrong_environment'
  | 'wrong_tag'
  | 'expired'
  | 'rolled_back'
  | 'verifier_unavailable';

export class ManifestVerificationError extends Error {
  constructor(readonly reason: ManifestRejectReason, message?: string) {
    super(message ?? `Client manifest rejected: ${reason}`);
    this.name = 'ManifestVerificationError';
  }
}

/**
 * Checks an ECDSA P-256 / SHA-256 signature (raw 64-byte `r‖s`) over `data` with a DER
 * SubjectPublicKeyInfo public key. Swappable for runtimes without WebCrypto (React Native
 * can plug in @noble/curves).
 */
export type ManifestSignatureVerifier = (
  spki: Bytes,
  data: Bytes,
  signature: Bytes,
) => Promise<boolean>;

/** A byte array over a plain ArrayBuffer, as WebCrypto requires. */
type Bytes = Uint8Array<ArrayBuffer>;

const importedKeys = new Map<string, Promise<CryptoKey>>();

const webCryptoVerifier: ManifestSignatureVerifier = async (spki, data, signature) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ManifestVerificationError('verifier_unavailable', 'WebCrypto is not available');
  }
  const cacheKey = toBase64(spki);
  let key = importedKeys.get(cacheKey);
  if (!key) {
    key = subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    importedKeys.set(cacheKey, key);
    key.catch(() => importedKeys.delete(cacheKey));
  }
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await key, signature, data);
};

let verifier: ManifestSignatureVerifier = webCryptoVerifier;

export function setManifestSignatureVerifier(next: ManifestSignatureVerifier): void {
  verifier = next;
}

export function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function isPayload(value: unknown): value is SignedClientManifestPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.schemaKey === 'string' &&
    typeof p.version === 'number' &&
    Number.isInteger(p.version) &&
    typeof p.tag === 'string' &&
    typeof p.environment === 'string' &&
    Array.isArray(p.rules) &&
    typeof p.issuedAt === 'string' &&
    typeof p.expiresAt === 'string'
  );
}

/**
 * Verifies an envelope and returns its payload. Order matters: the signature is checked
 * over the raw bytes BEFORE they are parsed, then the signed environment / tag / expiry.
 * Rollback (a lower version than one already seen) is checked by the caller, which owns
 * the per-device counter.
 */
export async function verifySignedClientManifest(
  envelope: SignedClientManifest,
  expectedTag: string,
  now: number = Date.now(),
): Promise<SignedClientManifestPayload> {
  const key = findTrustedManifestKey(envelope.kid);
  if (!key) throw new ManifestVerificationError('unknown_kid', `No trusted manifest key "${envelope.kid}"`);
  if (envelope.alg !== 'ES256') throw new ManifestVerificationError('unsupported_alg');

  let bytes: Bytes;
  let signature: Bytes;
  try {
    bytes = fromBase64(envelope.payload);
    signature = fromBase64(envelope.sig);
  } catch {
    throw new ManifestVerificationError('malformed_payload');
  }

  const valid = await verifier(fromBase64(key.spki), bytes, signature);
  if (!valid) throw new ManifestVerificationError('bad_signature');

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ManifestVerificationError('malformed_payload');
  }
  if (!isPayload(payload)) throw new ManifestVerificationError('malformed_payload');

  if (payload.environment !== key.environment) {
    throw new ManifestVerificationError(
      'wrong_environment',
      `Manifest for "${payload.environment}" signed with the "${key.environment}" key`,
    );
  }
  if (payload.tag !== expectedTag) throw new ManifestVerificationError('wrong_tag');

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt + EXPIRY_SKEW_MS <= now) {
    throw new ManifestVerificationError('expired');
  }

  return payload;
}
