import crypto from 'crypto';
import { logger } from '@/utils/logger';
import { entityServerKeyResolver } from '@/encryption/dek-resolver';
import { recordDecryptFailure } from '@/observability/crypto-metrics';
import { getSessionKey } from './session-key-store';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SERVER_CIPHERTEXT_VERSION = 'v1';
const CLIENT_CIPHERTEXT_VERSION = 'v1';
const SESSION_KEY_ID = 'sess';
const SESSION_KEY_PAYLOAD_VERSION = 'orgv1';

export interface ParsedEncryptedField {
  version: string;
  keyId: string;
  data: string;
}

export type WrappedSessionKeyPayload = {
  version: typeof SESSION_KEY_PAYLOAD_VERSION;
  keyRef: string;
  wrappedKey: Buffer;
};

export function containsSessionEncryptedFields(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.startsWith(`ENC:${CLIENT_CIPHERTEXT_VERSION}|${SESSION_KEY_ID}|`);
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsSessionEncryptedFields(item));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((nestedValue) => containsSessionEncryptedFields(nestedValue));
}

export function parseEncryptedField(value: string): ParsedEncryptedField | null {
  if (!value.startsWith('ENC:')) return null;
  const firstPipe = value.indexOf('|');
  if (firstPipe === -1) return null;
  const secondPipe = value.indexOf('|', firstPipe + 1);
  if (secondPipe === -1) return null;
  return {
    version: value.substring(4, firstPipe),
    keyId: value.substring(firstPipe + 1, secondPipe),
    data: value.substring(secondPipe + 1),
  };
}

function encryptAesGcm(plaintext: string, key: Buffer): string {
  return encryptAesGcmBuffer(Buffer.from(plaintext, 'utf8'), key).toString('base64');
}

export function encryptAesGcmBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
}

function decryptAesGcm(base64Data: string, key: Buffer): string {
  return decryptAesGcmBuffer(Buffer.from(base64Data, 'base64'), key).toString('utf8');
}

export function decryptAesGcmBuffer(combined: Buffer, key: Buffer): Buffer {
  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Encrypted data too short');
  }
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encodeWrappedSessionKeyPayload(keyRef: string, wrappedKey: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${SESSION_KEY_PAYLOAD_VERSION}|${keyRef}|`, 'utf8'), wrappedKey]);
}

export function decodeWrappedSessionKeyPayload(payload: Buffer): WrappedSessionKeyPayload {
  const firstDelimiter = payload.indexOf('|');
  const secondDelimiter = payload.indexOf('|', firstDelimiter + 1);
  if (firstDelimiter === -1 || secondDelimiter === -1) {
    throw new Error('Invalid session key payload format');
  }
  const version = payload.subarray(0, firstDelimiter).toString('utf8');
  if (version !== SESSION_KEY_PAYLOAD_VERSION) {
    throw new Error(`Unsupported session key payload version: ${version}`);
  }

  const keyRef = payload.subarray(firstDelimiter + 1, secondDelimiter).toString('utf8');
  const wrappedKey = payload.subarray(secondDelimiter + 1);
  if (!keyRef || wrappedKey.length === 0) {
    throw new Error('Invalid session key payload contents');
  }
  return {
    version,
    keyRef,
    wrappedKey,
  };
}

export async function decryptServerField(value: string): Promise<string> {
  const parsed = parseEncryptedField(value);
  if (!parsed || parsed.keyId === SESSION_KEY_ID) {
    return value;
  }

  try {
    const resolved = await entityServerKeyResolver.getKeyById(parsed.keyId);
    return decryptAesGcm(parsed.data, resolved.plaintextKey);
  } catch (err) {
    recordDecryptFailure('server_field', { keyId: parsed.keyId });
    logger.error('field-crypto: server decrypt failed', {
      keyId: parsed.keyId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(`Failed to decrypt server field for keyId=${parsed.keyId}`);
  }
}

export function encryptForSession(plaintext: string, aesKey: Buffer): string {
  return `ENC:${CLIENT_CIPHERTEXT_VERSION}|${SESSION_KEY_ID}|${encryptAesGcm(plaintext, aesKey)}`;
}

export function decryptClientField(value: string, aesKey: Buffer): string {
  const parsed = parseEncryptedField(value);
  if (!parsed || parsed.keyId !== SESSION_KEY_ID) {
    return value;
  }
  try {
    return decryptAesGcm(parsed.data, aesKey);
  } catch (err) {
    recordDecryptFailure('client_field', { keyId: parsed.keyId });
    logger.error('field-crypto: client decrypt failed', {
      keyId: parsed.keyId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error('Failed to decrypt client field');
  }
}

export async function reEncryptForServer(plaintext: string, entityId: string, entityType: string): Promise<string> {
  const resolved = await entityServerKeyResolver.getActiveKeyForEntity(entityId, entityType);
  return `ENC:${SERVER_CIPHERTEXT_VERSION}|${resolved.keyId}|${encryptAesGcm(plaintext, resolved.plaintextKey)}`;
}

export async function walkMutationArgs(body: Record<string, unknown>, sessionId: string): Promise<void> {
  const mutations = body.mutations;
  if (!Array.isArray(mutations)) {
    return;
  }
  const sessionKey = await getSessionKey(sessionId);
  if (!sessionKey) {
    if (containsSessionEncryptedFields(body)) {
      throw new Error('Encrypted mutation payload requires an active session key');
    }
    return;
  }
  for (const mutation of mutations) {
    if (!mutation || typeof mutation !== 'object') continue;
    const args = (mutation as Record<string, unknown>).args;
    if (!args || typeof args !== 'object') continue;
    walkObject(args as Record<string, unknown>, sessionKey);
  }
}

function walkObject(obj: Record<string, unknown>, userSessionKey: Buffer): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string' && value.startsWith(`ENC:${CLIENT_CIPHERTEXT_VERSION}|${SESSION_KEY_ID}|`)) {
      obj[key] = decryptClientField(value, userSessionKey);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          walkObject(item as Record<string, unknown>, userSessionKey);
        }
      }
      continue;
    }
    if (value && typeof value === 'object') {
      walkObject(value as Record<string, unknown>, userSessionKey);
    }
  }
}
