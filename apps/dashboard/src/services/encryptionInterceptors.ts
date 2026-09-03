import { InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { encryptField, decryptField, isEncryptedField, decryptionCache } from '@xyne/shared';
import { getEncryptionState, isEncryptionReady } from '../machines/encryptionMachine';
import { logger } from '../utils/logger';

/**
 * Recursively encrypt all string fields in an object.
 * Mirrors encryptMutationArgs from shared/src/hooks/useZero.ts
 */
async function encryptObject(obj: unknown): Promise<unknown> {
  if (!isEncryptionReady()) {
    return obj;
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => encryptObject(item)));
  }

  const key = getEncryptionState().key!;
  const record = obj as Record<string, unknown>;
  const encrypted: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > 0) {
      encrypted[fieldName] = await encryptField(value, key, fieldName);
    } else if (typeof value === 'object' && value !== null) {
      encrypted[fieldName] = await encryptObject(value);
    } else {
      encrypted[fieldName] = value;
    }
  }

  return encrypted;
}

/**
 * Recursively decrypt all encrypted fields in a response.
 * Uses decryptionCache for performance.
 */
async function decryptObject(obj: unknown): Promise<unknown> {
  if (!isEncryptionReady()) {
    return obj;
  }

  // Check if this is an encrypted field value
  if (typeof obj === 'string' && isEncryptedField(obj)) {
    const cached = decryptionCache.get(obj);
    if (cached !== undefined) {
      return cached;
    }

    const key = getEncryptionState().key!;
    const decrypted = await decryptField(obj, key);
    decryptionCache.set(obj, decrypted);
    return decrypted;
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => decryptObject(item)));
  }

  const record = obj as Record<string, unknown>;
  const decrypted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    decrypted[key] = await decryptObject(value);
  }

  return decrypted;
}

/**
 * Axios request interceptor for encrypting request bodies.
 * Applies to POST, PUT, PATCH methods with JSON data.
 */
export async function encryptionRequestInterceptor(
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> {
  if (!isEncryptionReady() || !getEncryptionState().apiClientEncryptionEnabled) {
    return config;
  }

  // Only encrypt request bodies for mutating methods
  const method = config.method?.toLowerCase();
  if (!method || !['post', 'put', 'patch'].includes(method)) {
    return config;
  }

  // Only encrypt JSON content
  if (!config.data || typeof config.data !== 'object') {
    return config;
  }

  // Preserve multipart uploads; encrypting FormData as a plain object drops fields/files.
  if (config.data instanceof FormData) {
    return config;
  }

  const encryptedData = await encryptObject(config.data);

  if (encryptedData !== config.data) {
    logger.info('[encryption] Encrypted request body', {
      url: config.url,
      method: config.method,
    });
  }

  config.data = encryptedData;

  return config;
}

/**
 * Axios response interceptor for decrypting response bodies.
 * Recursively scans for encrypted fields and decrypts them.
 */
export async function encryptionResponseInterceptor(
  response: AxiosResponse<unknown>,
): Promise<AxiosResponse<unknown>> {
  if (!isEncryptionReady() || !getEncryptionState().apiClientEncryptionEnabled) {
    return response;
  }

  // A Blob/ArrayBuffer response has `typeof === 'object'` but no enumerable
  // own properties, so decryptObject's Object.entries() walk would silently
  // replace it with `{}` instead of leaving it alone — skip binary response
  // types outright rather than only guarding on the value's shape.
  const responseType = response.config.responseType;
  if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'stream') {
    return response;
  }

  // Only decrypt JSON responses
  if (!response.data || typeof response.data !== 'object') {
    return response;
  }

  const decryptedData: unknown = await decryptObject(response.data);

  if (decryptedData !== response.data) {
    logger.info('[encryption] Decrypted response body', {
      url: response.config.url,
      status: response.status,
    });
  }

  response.data = decryptedData;

  return response;
}
