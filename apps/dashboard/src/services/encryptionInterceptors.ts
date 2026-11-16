import { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import {
  encryptField,
  decryptField,
  isEncryptedField,
  decryptionCache,
  getClientManifest,
  refreshClientManifest,
  CLIENT_MANIFEST_VERSION_HEADER,
  CLIENT_MANIFEST_TAG_HEADER,
  CLIENT_MANIFEST_STALE_CODE,
  findRequestRule,
  encryptBodyWithRule,
  encryptFormDataWithRule,
} from '@xyne/shared';
import type { ClientManifestRule } from '@xyne/shared';
import { getEncryptionState, isEncryptionReady } from '../machines/encryptionMachine';
import { logger } from '../utils/logger';

/** Per-request state for the stale-manifest retry. */
export type ClientManifestRetryConfig = InternalAxiosRequestConfig & {
  _encManifestRetried?: boolean;
  /** Body as the caller passed it, before encryption, so a retry re-encrypts from plaintext. */
  _encOriginalData?: unknown;
};

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

// Routes whose unknown body keys have already been logged, so each warns once.
const loggedUnknownKeyRoutes = new Set<string>();

function warnUnknownKeys(rule: ClientManifestRule, unknownKeys: string[]): void {
  if (unknownKeys.length === 0 || loggedUnknownKeyRoutes.has(rule.value)) return;
  loggedUnknownKeyRoutes.add(rule.value);
  logger.warn('[encryption] Request body has keys missing from the client manifest rule', {
    route: rule.value,
    unknownKeys,
  });
}

function cloneFormData(source: FormData): FormData {
  const clone = new FormData();
  source.forEach((value, key) => clone.append(key, value));
  return clone;
}

/**
 * Encrypt a request body by its manifest rule: only `client: true` fields are encrypted.
 * The caller's body is never mutated (FormData is cloned), so `_encOriginalData` stays
 * plaintext for the stale-manifest retry.
 */
async function encryptWithRule(
  config: ClientManifestRetryConfig,
  rule: ClientManifestRule,
): Promise<void> {
  const key = getEncryptionState().key!;
  const encrypt = (value: string, fieldName: string) => encryptField(value, key, fieldName);

  if (config._encOriginalData === undefined) {
    config._encOriginalData = config.data;
  }

  if (config.data instanceof FormData) {
    const formData = cloneFormData(config.data);
    const { unknownKeys } = await encryptFormDataWithRule(formData, rule, encrypt);
    warnUnknownKeys(rule, unknownKeys);
    config.data = formData;
  } else {
    const { body, unknownKeys } = await encryptBodyWithRule(
      config.data as Record<string, unknown>,
      rule,
      encrypt,
    );
    warnUnknownKeys(rule, unknownKeys);
    config.data = body;
  }

  logger.info('[encryption] Encrypted request body by manifest rule', {
    url: config.url,
    method: config.method,
    route: rule.value,
  });
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

  const method = config.method?.toLowerCase();
  if (!method || !['post', 'put', 'patch', 'delete'].includes(method)) {
    return config;
  }

  // Stamp the manifest version on every mutating request, multipart included, so the
  // backend can reject writes made against a stale manifest.
  const manifest = getClientManifest();
  if (manifest) {
    config.headers[CLIENT_MANIFEST_VERSION_HEADER] = String(manifest.version);
    config.headers[CLIENT_MANIFEST_TAG_HEADER] = manifest.tag;
  }

  // Only encrypt request bodies for POST, PUT and PATCH
  if (method === 'delete') {
    return config;
  }

  // Only encrypt JSON content
  if (!config.data || typeof config.data !== 'object') {
    return config;
  }

  // Routes listed in the manifest are encrypted field-by-field from their rule, multipart
  // included. Everything else keeps the behaviour below.
  const rule =
    manifest && !Array.isArray(config.data)
      ? findRequestRule(manifest, method, new URL(config.url ?? '', 'http://localhost').pathname)
      : undefined;
  if (rule) {
    await encryptWithRule(config as ClientManifestRetryConfig, rule);
    return config;
  }

  // Preserve multipart uploads; encrypting FormData as a plain object drops fields/files.
  if (config.data instanceof FormData) {
    return config;
  }

  const retryConfig = config as ClientManifestRetryConfig;
  if (retryConfig._encOriginalData === undefined) {
    retryConfig._encOriginalData = config.data;
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

/**
 * Retry once when the backend rejects a write for a stale client manifest (409
 * ENC_MANIFEST_STALE): refresh the manifest, then re-send through `resend` (the same
 * axios instance) so the request interceptor re-stamps the headers. Returns null when
 * the error is not a stale-manifest rejection or the request was already retried.
 */
export async function retryOnStaleClientManifest(
  error: AxiosError,
  resend: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>,
): Promise<AxiosResponse | null> {
  if (!getEncryptionState().apiClientEncryptionEnabled) {
    return null;
  }

  const config = error.config as ClientManifestRetryConfig | undefined;
  const data = error.response?.data as { code?: string } | undefined;
  if (
    !config ||
    error.response?.status !== 409 ||
    data?.code !== CLIENT_MANIFEST_STALE_CODE ||
    config._encManifestRetried
  ) {
    return null;
  }
  config._encManifestRetried = true;

  try {
    await refreshClientManifest();
  } catch (err) {
    logger.error('[encryption] Failed to refresh client manifest after stale rejection', {
      url: config.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // encryptObject does not skip already-encrypted strings, and axios has already
  // serialized config.data by now, so re-send the caller's original body and let the
  // request interceptor encrypt it afresh.
  if (config._encOriginalData !== undefined) {
    config.data = config._encOriginalData;
  }

  logger.info('[encryption] Retrying request after client manifest refresh', {
    url: config.url,
    method: config.method,
  });

  return resend(config);
}
