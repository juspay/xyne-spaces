import { decrypt, encrypt } from './encryptionService';

const VERSION_TAG = 'v2';
const LEGACY_KEY_ID = 'legacy';
const ENCRYPTED_VALUE_PREFIX = 'enc:';
const IV_HEX_LENGTH = 32;
const AES_BLOCK_HEX_LENGTH = 32;
const MAX_FAILURE_SAMPLES = 5;

export type CiphertextClassification =
  | { kind: 'legacy'; keyId: typeof LEGACY_KEY_ID }
  | { kind: 'active'; keyId: string }
  | { kind: 'other-key'; keyId: string }
  | { kind: 'malformed' };

export type RotationOutcome =
  | 'already-active'
  | 'would-rotate'
  | 'rotated'
  | 'malformed'
  | 'failed';

export interface CiphertextRotationResult {
  value: string;
  classification: CiphertextClassification;
  outcome: RotationOutcome;
  error?: string;
}

export interface JsonRotationStats {
  encryptedValues: number;
  legacy: number;
  active: number;
  otherKey: number;
  malformed: number;
  failed: number;
  failureSamples: string[];
  wouldRotate: number;
  rotated: number;
  byKeyId: Record<string, number>;
}

export interface JsonRotationResult<T> {
  value: T;
  changed: boolean;
  stats: JsonRotationStats;
}

function requireRotationKeyId(activeKeyId: string): string {
  const normalized = activeKeyId.trim();

  if (!normalized) {
    throw new Error('An active encryption key is required for an encryption backfill');
  }

  if (normalized === LEGACY_KEY_ID) {
    throw new Error('The encryption backfill active key must not be "legacy"');
  }

  return normalized;
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function hasValidIv(value: string): boolean {
  return value.length === IV_HEX_LENGTH && isHex(value);
}

function hasValidCiphertext(value: string): boolean {
  return isHex(value) && value.length % AES_BLOCK_HEX_LENGTH === 0;
}

export function classifyCiphertext(value: string, activeKeyId: string): CiphertextClassification {
  const normalizedActiveKeyId = requireRotationKeyId(activeKeyId);
  const parts = value.split(':');

  if (parts.length === 2 && hasValidIv(parts[0]) && hasValidCiphertext(parts[1])) {
    return { kind: 'legacy', keyId: LEGACY_KEY_ID };
  }

  if (
    parts.length === 4 &&
    parts[0] === VERSION_TAG &&
    parts[1].length > 0 &&
    hasValidIv(parts[2]) &&
    hasValidCiphertext(parts[3])
  ) {
    const keyId = parts[1];

    return keyId === normalizedActiveKeyId
      ? { kind: 'active', keyId }
      : { kind: 'other-key', keyId };
  }

  return { kind: 'malformed' };
}

export function rotateCiphertext(
  value: string,
  activeKeyId: string,
  apply: boolean
): CiphertextRotationResult {
  const normalizedActiveKeyId = requireRotationKeyId(activeKeyId);
  const classification = classifyCiphertext(value, normalizedActiveKeyId);

  if (classification.kind === 'malformed') {
    return {
      value,
      classification,
      outcome: 'malformed',
    };
  }

  if (classification.kind === 'active') {
    return {
      value,
      classification,
      outcome: 'already-active',
    };
  }

  try {
    const plaintext = decrypt(value);

    if (!apply) {
      return {
        value,
        classification,
        outcome: 'would-rotate',
      };
    }

    const rotated = encrypt(plaintext);
    const expectedPrefix = `${VERSION_TAG}:${normalizedActiveKeyId}:`;

    if (!rotated.startsWith(expectedPrefix)) {
      throw new Error(`encrypt() did not write with active key "${normalizedActiveKeyId}"`);
    }

    return {
      value: rotated,
      classification,
      outcome: 'rotated',
    };
  } catch (err) {
    return {
      value,
      classification,
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function createJsonRotationStats(): JsonRotationStats {
  return {
    encryptedValues: 0,
    legacy: 0,
    active: 0,
    otherKey: 0,
    malformed: 0,
    failed: 0,
    failureSamples: [],
    wouldRotate: 0,
    rotated: 0,
    byKeyId: {},
  };
}

function recordRotationResult(stats: JsonRotationStats, result: CiphertextRotationResult): void {
  stats.encryptedValues += 1;

  switch (result.classification.kind) {
    case 'legacy':
      stats.legacy += 1;
      break;
    case 'active':
      stats.active += 1;
      break;
    case 'other-key':
      stats.otherKey += 1;
      break;
    case 'malformed':
      stats.malformed += 1;
      break;
  }

  if (result.classification.kind !== 'malformed') {
    const keyId = result.classification.keyId;
    stats.byKeyId[keyId] = (stats.byKeyId[keyId] ?? 0) + 1;
  }

  switch (result.outcome) {
    case 'failed':
      stats.failed += 1;

      if (result.error && stats.failureSamples.length < MAX_FAILURE_SAMPLES) {
        stats.failureSamples.push(result.error);
      }

      break;
    case 'would-rotate':
      stats.wouldRotate += 1;
      break;
    case 'rotated':
      stats.rotated += 1;
      break;
    default:
      break;
  }
}

export function rotateEncryptedJsonStrings<T>(
  input: T,
  activeKeyId: string,
  apply: boolean
): JsonRotationResult<T> {
  const normalizedActiveKeyId = requireRotationKeyId(activeKeyId);
  const stats = createJsonRotationStats();
  let changed = false;

  function visit(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
      const ciphertext = value.slice(ENCRYPTED_VALUE_PREFIX.length);
      const result = rotateCiphertext(ciphertext, normalizedActiveKeyId, apply);

      recordRotationResult(stats, result);

      if (result.outcome === 'rotated') {
        changed = true;
        return ENCRYPTED_VALUE_PREFIX + result.value;
      }

      return value;
    }

    if (Array.isArray(value)) {
      return value.map(visit);
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, visit(nestedValue)])
      );
    }

    return value;
  }

  return {
    value: visit(input) as T,
    changed,
    stats,
  };
}
