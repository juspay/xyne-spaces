import { API_BASE_URL } from '../config.js';

/**
 * Signing public keys published by the encryption service (JWKS on its /zero route, not
 * via the backend) and one verifier for every purpose.
 */
// To verify another signed thing, add its purpose here and in LABELS (and on the server, signing.rs).
export type EncSigningPurpose = 'manifest';

const LABELS: Record<EncSigningPurpose, string> = {
  manifest: 'xyne-enc/manifest/v1',
};

export interface EncSigningJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  alg: 'ES256';
  use: 'sig';
  kid: string;
  purpose: EncSigningPurpose;
}

/** A byte array over a plain ArrayBuffer, as WebCrypto requires. */
type Bytes = Uint8Array<ArrayBuffer>;

/** Verifies a raw 64-byte `r‖s` ECDSA P-256 / SHA-256 signature. Swappable (React Native). */
export type EncSignatureVerifier = (key: EncSigningJwk, data: Bytes, signature: Bytes) => Promise<boolean>;

/** Min interval between refetches triggered by an unknown `kid`. */
const MIN_REFETCH_MS = 60_000;
/** Once set, unsigned manifests are never accepted again on this device. */
const SIGNING_SEEN_KEY = 'xyne.enc.signing.seen';

let keysUrl = `${API_BASE_URL.replace(/\/api\/?$/, '')}/zero/.well-known/enc-signing-keys.json`;
let cached: EncSigningJwk[] | null = null;
let fetchedAt = 0;
let inFlight: Promise<EncSigningJwk[] | null> | null = null;
let signingSeen = readSigningSeen();
const importedKeys = new Map<string, Promise<CryptoKey>>();

/** Where the keys are served; the dashboard points it at its Zero origin at boot. */
export function setEncSigningKeysUrl(url: string): void {
  keysUrl = url;
  cached = null;
  fetchedAt = 0;
}

function readSigningSeen(): boolean {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem(SIGNING_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSigningSeen(): void {
  signingSeen = true;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(SIGNING_SEEN_KEY, '1');
  } catch {
    // Storage unavailable: the flag holds for this page only.
  }
}

function isJwk(value: unknown): value is EncSigningJwk {
  if (!value || typeof value !== 'object') return false;
  const k = value as Record<string, unknown>;
  return (
    k.kty === 'EC' &&
    k.crv === 'P-256' &&
    k.alg === 'ES256' &&
    typeof k.x === 'string' &&
    typeof k.y === 'string' &&
    typeof k.kid === 'string' &&
    typeof k.purpose === 'string' &&
    Object.prototype.hasOwnProperty.call(LABELS, k.purpose)
  );
}

/** Published keys; `null` if they could not be fetched (caller fails closed). 404 = none. */
export function loadEncSigningKeys(force = false): Promise<EncSigningJwk[] | null> {
  if (cached && !force) return Promise.resolve(cached);
  if (force && cached && Date.now() - fetchedAt < MIN_REFETCH_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<EncSigningJwk[] | null> => {
    try {
      const response = await fetch(keysUrl, { credentials: 'omit' });
      if (response.status === 404) {
        cached = [];
      } else if (!response.ok) {
        return cached;
      } else {
        const data = (await response.json()) as { keys?: unknown };
        cached = Array.isArray(data.keys) ? data.keys.filter(isJwk) : [];
      }
      fetchedAt = Date.now();
      if (cached.length > 0) rememberSigningSeen();
      return cached;
    } catch {
      return cached;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Required once a key for `purpose` was ever seen here; `null` = unknown (treat as required). */
export async function isEncSigningRequired(purpose: EncSigningPurpose): Promise<boolean | null> {
  const keys = await loadEncSigningKeys();
  if (keys === null) return signingSeen ? true : null;
  return signingSeen || keys.some(k => k.purpose === purpose);
}

async function findKey(purpose: EncSigningPurpose, kid: string): Promise<EncSigningJwk | undefined> {
  const match = (keys: EncSigningJwk[] | null) => keys?.find(k => k.kid === kid && k.purpose === purpose);
  return match(await loadEncSigningKeys()) ?? match(await loadEncSigningKeys(true));
}

const webCryptoVerifier: EncSignatureVerifier = async (key, data, signature) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is not available');
  let imported = importedKeys.get(key.kid);
  if (!imported) {
    imported = subtle.importKey(
      'jwk',
      { kty: key.kty, crv: key.crv, x: key.x, y: key.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    importedKeys.set(key.kid, imported);
    imported.catch(() => importedKeys.delete(key.kid));
  }
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await imported, signature, data);
};

let verifier: EncSignatureVerifier = webCryptoVerifier;

export function setEncSignatureVerifier(next: EncSignatureVerifier): void {
  verifier = next;
}

export type EncSignatureResult = 'valid' | 'invalid' | 'unknown_kid';

/** Checks `signature` over `label(purpose) || 0x00 || payload` with the published key `kid`. */
export async function verifyEncSignature(
  purpose: EncSigningPurpose,
  payload: Bytes,
  signature: Bytes,
  kid: string,
): Promise<EncSignatureResult> {
  const key = await findKey(purpose, kid);
  if (!key) return 'unknown_kid';
  const label = new TextEncoder().encode(LABELS[purpose]);
  const message = new Uint8Array(label.length + 1 + payload.length);
  message.set(label, 0);
  message[label.length] = 0;
  message.set(payload, label.length + 1);
  return (await verifier(key, message, signature)) ? 'valid' : 'invalid';
}
