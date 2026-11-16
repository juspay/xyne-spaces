import type {
  SignedClientManifest,
  SignedClientManifestPayload,
} from '../enc-contracts/manifest.js';
import { verifyEncSignature } from './enc-signing-keys.js';

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

/** A byte array over a plain ArrayBuffer, as WebCrypto requires. */
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Environments this build accepts a manifest for: the production apps accept 'production'
 * and 'playground' (pre-prod is a lane of the same deployment, chosen per request by
 * x-route-env, so the server picks between them), a sandbox build only 'sandbox', a local
 * build only 'development'. `null` = not configured, any environment.
 */
let allowedEnvironments: readonly string[] | null = null;

export function setAllowedManifestEnvironments(environments: readonly string[] | null): void {
  allowedEnvironments = environments && environments.length > 0 ? [...environments] : null;
}

export function getAllowedManifestEnvironments(): readonly string[] | null {
  return allowedEnvironments;
}

export function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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

/** Verifies the signature over the raw bytes, then environment, tag and expiry. */
export async function verifySignedClientManifest(
  envelope: SignedClientManifest,
  expectedTag: string,
  now: number = Date.now(),
): Promise<SignedClientManifestPayload> {
  if (envelope.alg !== 'ES256') throw new ManifestVerificationError('unsupported_alg');

  let bytes: Bytes;
  let signature: Bytes;
  try {
    bytes = fromBase64(envelope.payload);
    signature = fromBase64(envelope.sig);
  } catch {
    throw new ManifestVerificationError('malformed_payload');
  }

  let result;
  try {
    result = await verifyEncSignature('manifest', bytes, signature, envelope.kid);
  } catch (error) {
    throw new ManifestVerificationError(
      'verifier_unavailable',
      error instanceof Error ? error.message : String(error),
    );
  }
  if (result === 'unknown_kid') {
    throw new ManifestVerificationError('unknown_kid', `No published manifest key "${envelope.kid}"`);
  }
  if (result !== 'valid') throw new ManifestVerificationError('bad_signature');

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ManifestVerificationError('malformed_payload');
  }
  if (!isPayload(payload)) throw new ManifestVerificationError('malformed_payload');

  if (allowedEnvironments && !allowedEnvironments.includes(payload.environment)) {
    throw new ManifestVerificationError(
      'wrong_environment',
      `This build does not accept a manifest for "${payload.environment}"`,
    );
  }
  if (payload.tag !== expectedTag) throw new ManifestVerificationError('wrong_tag');

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt + EXPIRY_SKEW_MS <= now) {
    throw new ManifestVerificationError('expired');
  }

  return payload;
}
