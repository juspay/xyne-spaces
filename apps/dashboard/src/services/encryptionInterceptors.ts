import { InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { encryptField, decryptField, isEncryptedField, decryptionCache } from '@xyne/shared';
import { getEncryptionState, isEncryptionReady } from '../machines/encryptionMachine';

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

  try {
    for (const [fieldName, value] of Object.entries(record)) {
      if (typeof value === 'string' && value.length > 0) {
        encrypted[fieldName] = await encryptField(value, key, fieldName);
      } else if (typeof value === 'object' && value !== null) {
        encrypted[fieldName] = await encryptObject(value);
      } else {
        encrypted[fieldName] = value;
      }
    }
  } catch (error) {
    console.log('[encryption] Failed to encrypt request body, sending plaintext', {
      error: error instanceof Error ? error.message : String(error),
    });
    return obj;
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
    try {
      const decrypted = await decryptField(obj, key);
      decryptionCache.set(obj, decrypted);
      return decrypted;
    } catch (error) {
      console.log('[encryption] Failed to decrypt field, returning encrypted value', {
        error: error instanceof Error ? error.message : String(error),
      });
      return obj;
    }
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

  try {
    const encryptedData = await encryptObject(config.data);

    if (encryptedData !== config.data) {
      console.log('[encryption] Encrypted request body', {
        url: config.url,
        method: config.method,
      });
    }

    config.data = encryptedData;
  } catch (error) {
    // Fail open - log and continue with plaintext
    console.log('[encryption] Request encryption failed, sending plaintext', {
      error: error instanceof Error ? error.message : String(error),
      url: config.url,
    });
  }

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

  // Only decrypt JSON responses
  if (!response.data || typeof response.data !== 'object') {
    return response;
  }

  try {
    const decryptedData: unknown = await decryptObject(response.data);

    if (decryptedData !== response.data) {
      console.log('[encryption] Decrypted response body', {
        url: response.config.url,
        status: response.status,
      });
    }

    response.data = decryptedData;
  } catch (error) {
    // Fail open - log and return original response
    console.log('[encryption] Response decryption failed, returning encrypted data', {
      error: error instanceof Error ? error.message : String(error),
      url: response.config.url,
    });
  }

  return response;
}
