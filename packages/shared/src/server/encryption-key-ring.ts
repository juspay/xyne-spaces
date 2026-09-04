/**
 * Server-only parser for ordered encryption key rings.
 *
 * This module performs no file or environment access. Services
 * decide where configuration comes from and how fallback works.
 */

export type EncryptionKeyRingErrorReason =
  | 'keyring_json_invalid'
  | 'keyring_validation_failed'
  | 'active_key_missing';

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
  activeKeyId: string | null;
}

function invalidJson(message: string): never {
  throw new EncryptionKeyRingConfigError(
    'keyring_json_invalid',
    message
  );
}

function invalidEntry(message: string): never {
  throw new EncryptionKeyRingConfigError(
    'keyring_validation_failed',
    message
  );
}

export function parseEncryptionKeyRing(
  rawKeys: string,
  rawActiveKeyId?: string
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
    return invalidJson(
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
      invalidEntry(
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
      invalidEntry(
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
      invalidEntry(
        `Invalid key ID at index ${index}`
      );
    }

    if (keys.has(id)) {
      invalidEntry(
        `Duplicate key ID at index ${index}`
      );
    }

    if (typeof entry.key !== 'string') {
      invalidEntry(
        `Invalid key value at index ${index}`
      );
    }

    const normalizedKey = entry.key.trim();

    if (
      !/^[0-9a-fA-F]{64}$/.test(normalizedKey)
    ) {
      invalidEntry(
        `Invalid key value at index ${index}`
      );
    }

    keys.set(
      id,
      Buffer.from(normalizedKey, 'hex')
    );
  });

  const activeKeyId =
    rawActiveKeyId?.trim() || null;

  if (activeKeyId && !keys.has(activeKeyId)) {
    throw new EncryptionKeyRingConfigError(
      'active_key_missing',
      'The active key is not present in the key ring'
    );
  }

  return {
    keys,
    activeKeyId,
  };
}
