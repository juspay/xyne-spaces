/**
 * Public keys this client trusts to sign the client encryption manifest.
 *
 * They are built into the app and never fetched: the backend relays the manifest, so a
 * key it served could just as well be its own. Each key is bound to one environment, so
 * a manifest signed for pre-production can never be accepted by a production client.
 *
 * Get a key's value from its Cloud KMS key version:
 *   gcloud kms keys versions get-public-key <n> --key <key> --keyring <ring> --location <loc> \
 *     | openssl ec -pubin -outform DER | base64
 * or, for a local key created with `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256`:
 *   openssl pkey -in key.pem -pubout -outform DER | base64
 */
export interface TrustedManifestKey {
  /** Matches `MANIFEST_SIGNING_KEY_ID` on the encryption service. */
  kid: string;
  /** The only `environment` a manifest signed by this key may carry. */
  environment: string;
  /** base64 of the DER SubjectPublicKeyInfo of an EC P-256 key. */
  spki: string;
}

/**
 * Production / pre-production keys, added here once their KMS keys exist. Keep the
 * current and the next key listed while rotating, so clients on either keep working.
 */
const BUILT_IN_KEYS: readonly TrustedManifestKey[] = [];

const registeredKeys: TrustedManifestKey[] = [];

/**
 * Adds keys at boot, e.g. a local development key from the app's build-time env. Call
 * before the first manifest fetch.
 */
export function registerTrustedManifestKeys(keys: readonly TrustedManifestKey[]): void {
  for (const key of keys) {
    if (!key.kid || !key.environment || !key.spki) continue;
    if (registeredKeys.some(k => k.kid === key.kid)) continue;
    registeredKeys.push(key);
  }
}

export function getTrustedManifestKeys(): readonly TrustedManifestKey[] {
  return [...BUILT_IN_KEYS, ...registeredKeys];
}

export function findTrustedManifestKey(kid: string): TrustedManifestKey | undefined {
  return getTrustedManifestKeys().find(key => key.kid === kid);
}

/**
 * Parses a build-time list of keys (JSON array of `TrustedManifestKey`), ignoring
 * malformed input so a bad env value cannot break app start.
 */
export function parseTrustedManifestKeys(json: string | undefined): TrustedManifestKey[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (k): k is TrustedManifestKey =>
        !!k &&
        typeof k === 'object' &&
        typeof (k as TrustedManifestKey).kid === 'string' &&
        typeof (k as TrustedManifestKey).environment === 'string' &&
        typeof (k as TrustedManifestKey).spki === 'string',
    );
  } catch {
    return [];
  }
}
