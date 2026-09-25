/**
 * Encryption Service
 * AES-256-CBC encryption/decryption for sensitive data
 *
 * Two ciphertext formats coexist:
 *   legacy  "<iv-hex>:<ct-hex>"        AES-256-CBC under the single ENCRYPTION_KEY
 *   scoped  "ENC:v1|<dekId>|<base64>"  AES-256-GCM under the tenant's own data
 *                                      encryption key, which the encryption
 *                                      service resolves from (entityType, entityId)
 *
 * Reads accept either format. The "ENC:" prefix is the discriminator and the key
 * id travels inside the value, so decryption never needs a tenant argument —
 * only writes do.
 */

import crypto from 'crypto';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // AES block size

// Prefix stamped by the encryption service's server-field format.
const SCOPED_PREFIX = 'ENC:';

export const ENTITY_TYPE_WORKSPACE = 'WORKSPACE';
export const ENTITY_TYPE_ORG = 'ORG';

/**
 * Which tenant a secret belongs to. The encryption service maps this to that
 * tenant's active DEK and stamps the key id into the ciphertext it returns.
 */
export type EncryptionScope =
  | { entityType: typeof ENTITY_TYPE_WORKSPACE; entityId: string }
  | { entityType: typeof ENTITY_TYPE_ORG; entityId: string };

export function workspaceScope(workspaceId: string): EncryptionScope {
  return { entityType: ENTITY_TYPE_WORKSPACE, entityId: workspaceId };
}

export function orgScope(orgId: string): EncryptionScope {
  return { entityType: ENTITY_TYPE_ORG, entityId: orgId };
}

/**
 * Get encryption key from environment
 * Must be 32 bytes (64 hex characters) for AES-256
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }

  // Convert hex string to buffer
  const keyBuffer = Buffer.from(key, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  return keyBuffer;
}

/**
 * Encrypt plaintext using AES-256-CBC
 * Returns format: "IV:ciphertext" (both as hex)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Return IV:ciphertext format
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt ciphertext using AES-256-CBC
 * Expects format: "IV:ciphertext" (both as hex)
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();

  // Split IV and ciphertext
  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format. Expected "IV:ciphertext"');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH} bytes`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * True when the value was written under a tenant-scoped key rather than the
 * legacy global one.
 */
export function isScopedCiphertext(value: string): boolean {
  return typeof value === 'string' && value.startsWith(SCOPED_PREFIX);
}

/**
 * An empty entityId would silently map every tenant onto one bogus DEK, so a
 * missing workspace/org id has to fail loudly at the call site instead.
 */
function assertScope(scope: EncryptionScope): void {
  const entityId = scope?.entityId;

  if (typeof entityId !== 'string' || entityId.trim() === '') {
    throw new Error(
      `Encryption scope requires a non-empty entityId (entityType=${scope?.entityType ?? 'unknown'})`,
    );
  }
}

/**
 * Encrypt under the tenant's own key.
 *
 * When ENABLE_DB_ENCRYPTION is off the provider is a pass-through that hands
 * values straight back, so fall through to the legacy global key rather than
 * writing plaintext into a secrets column.
 */
export async function encryptScopedBatch(
  values: string[],
  scope: EncryptionScope,
): Promise<string[]> {
  if (values.length === 0) return [];

  assertScope(scope);

  if (!config.enc.enableDbEncryption) {
    return values.map((value) => encrypt(value));
  }

  const encrypted = await getEncryptionProvider().encryptBatch(
    values.map((value) => ({
      value,
      entityId: scope.entityId,
      entityType: scope.entityType,
    })),
  );

  if (encrypted.length !== values.length) {
    throw new Error('Encryption provider returned a mismatched batch size');
  }

  // A pass-through response means the value was never encrypted; storing it
  // would leak the secret in cleartext.
  for (const value of encrypted) {
    if (!isScopedCiphertext(value)) {
      throw new Error(
        `Encryption provider did not return scoped ciphertext for ${scope.entityType}:${scope.entityId}`,
      );
    }
  }

  return encrypted;
}

export async function encryptScoped(
  plaintext: string,
  scope: EncryptionScope,
): Promise<string> {
  const [value] = await encryptScopedBatch([plaintext], scope);
  return value;
}

/**
 * Decrypt values written by either path, in one round-trip for the scoped ones.
 * Legacy values are unwrapped locally; no tenant argument is needed either way.
 */
export async function decryptAsyncBatch(values: string[]): Promise<string[]> {
  if (values.length === 0) return [];

  const scopedIndexes: number[] = [];
  const scopedValues: string[] = [];

  values.forEach((value, index) => {
    if (isScopedCiphertext(value)) {
      scopedIndexes.push(index);
      scopedValues.push(value);
    }
  });

  const out = values.map((value) =>
    isScopedCiphertext(value) ? value : decrypt(value),
  );

  if (scopedValues.length === 0) return out;

  const decrypted = await getEncryptionProvider().decryptBatch(scopedValues);

  if (decrypted.length !== scopedValues.length) {
    throw new Error('Encryption provider returned a mismatched batch size');
  }

  decrypted.forEach((value, index) => {
    // Still prefixed means the provider declined to decrypt, which happens when
    // ENABLE_DB_DECRYPTION is off. Returning it would hand ciphertext to callers
    // expecting a secret.
    if (isScopedCiphertext(value)) {
      throw new Error(
        'Encryption provider returned ciphertext; ENABLE_DB_DECRYPTION is likely disabled',
      );
    }

    out[scopedIndexes[index]] = value;
  });

  return out;
}

export async function decryptAsync(encryptedData: string): Promise<string> {
  const [value] = await decryptAsyncBatch([encryptedData]);
  return value;
}
