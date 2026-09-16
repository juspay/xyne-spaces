/**
 * Server-only parser for ordered encryption key rings.
 *
 * This module performs no file or environment access. Services
 * read the key-ring JSON from their own environment file and
 * decide how fallback works. Every entry in the returned ring is
 * a valid decryption key; which key (if any) writes is the
 * caller's policy — the backend selects it with
 * ENCRYPTION_ACTIVE_KEY_ID.
 */

export type EncryptionKeyRingErrorReason =
  | 'keyring_json_invalid'
  | 'keyring_validation_failed';

export class EncryptionKeyRingConfigError
  extends Error {
  constructor(
    readonly reason:
      EncryptionKeyRingErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'EncryptionKeyRingConfigError';
  }
}

export interface ParsedEncryptionKeyRing {
  keys: ReadonlyMap<string, Buffer>;
}

function invalidJson(message: string): never {
  throw new EncryptionKeyRingConfigError(
    'keyring_json_invalid',
    message
  );
}

function invalidRing(message: string): never {
  throw new EncryptionKeyRingConfigError(
    'keyring_validation_failed',
    message
  );
}

export function parseEncryptionKeyRing(
  rawKeys: string
): ParsedEncryptionKeyRing {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    return invalidJson(
      'Encryption keys must be valid JSON'
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return invalidRing(
      'Encryption keys must be a non-empty array'
    );
  }

  const keys = new Map<string, Buffer>();

  parsed.forEach((value, index) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      invalidRing(
        `Invalid key-ring entry at index ${index}`
      );
    }

    const entry = value as {
      id?: unknown;
      key?: unknown;
    };

    if (
      typeof entry.id !== 'string' ||
      entry.id !== entry.id.trim()
    ) {
      invalidRing(
        `Invalid key ID at index ${index}`
      );
    }

    const id = entry.id;

    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(
        id
      ) ||
      id === 'legacy' ||
      id === 'v2'
    ) {
      invalidRing(
        `Invalid key ID at index ${index}`
      );
    }

    if (keys.has(id)) {
      invalidRing(
        `Duplicate key ID at index ${index}`
      );
    }

    if (typeof entry.key !== 'string') {
      invalidRing(
        `Invalid key value at index ${index}`
      );
    }

    const normalizedKey = entry.key.trim();

    if (
      !/^[0-9a-fA-F]{64}$/.test(normalizedKey)
    ) {
      invalidRing(
        `Invalid key value at index ${index}`
      );
    }

    keys.set(
      id,
      Buffer.from(normalizedKey, 'hex')
    );
  });

  return {
    keys,
  };
}
