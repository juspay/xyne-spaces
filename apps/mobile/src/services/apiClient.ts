import {
  isMtlsRequestError,
  MtlsRequestError,
  MtlsRequestOptions,
  mtlsRequestJson,
  mtlsRequestText,
} from './MtlsApiService';
import {
  CLIENT_MANIFEST_STALE_CODE,
  decryptTransitFields,
  encryptBodyWithRule,
  encryptField,
  findRequestRule,
  getClientManifest,
  refetchClientManifest,
} from '@xyne/shared';
import { getActiveKeyring } from './encryption/activeKeyring';

type RequestExtras = {
  token?: string;
  headers?: Record<string, string>;
  /** Aborts the request down to the native socket. */
  signal?: AbortSignal;
  /** Overrides the default request deadline. */
  timeoutMs?: number;
};

function withAuthHeaders(token?: string, headers?: Record<string, string>): Record<string, string> {
  if (!token) return { ...(headers ?? {}) };
  return {
    ...(headers ?? {}),
    Authorization: `Bearer ${token}`,
  };
}

type RequestBody = Exclude<MtlsRequestOptions['body'], undefined>;

/** Encrypts the body's `client: true` fields by the route's manifest rule, as the dashboard does. */
async function encryptBodyByRule(
  path: string,
  method: MtlsRequestOptions['method'],
  body: RequestBody,
): Promise<RequestBody> {
  const keyring = getActiveKeyring();
  const manifest = getClientManifest();
  if (!keyring || !manifest || !method || !['POST', 'PUT', 'PATCH'].includes(method)) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const rule = findRequestRule(manifest, method, path);
  if (!rule) return body;
  const encrypted = await encryptBodyWithRule(body, rule, (value, field) =>
    encryptField(value, keyring, field),
  );
  return encrypted.body as RequestBody;
}

/** The server's latest manifest when it rejected the body for a stale one (409). */
function staleManifest(error: unknown): { latestVersion?: number; environment?: string } | null {
  if (!isMtlsRequestError(error) || error.statusCode !== 409) return null;
  try {
    const data = JSON.parse(error.responseBody) as {
      code?: string;
      latestVersion?: number;
      environment?: string;
    };
    return data.code === CLIENT_MANIFEST_STALE_CODE ? data : null;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  path: string,
  options?: MtlsRequestOptions & { token?: string },
): Promise<T> {
  const requestOptions: MtlsRequestOptions = {
    headers: withAuthHeaders(options?.token, options?.headers),
  };
  if (options?.signal !== undefined) {
    requestOptions.signal = options.signal;
  }
  if (options?.timeoutMs !== undefined) {
    requestOptions.timeoutMs = options.timeoutMs;
  }
  if (options?.method !== undefined) {
    requestOptions.method = options.method;
  }
  // Encrypted from the caller's plaintext on every send, so the stale-manifest retry re-encrypts.
  const send = async (): Promise<T> => {
    if (options?.body !== undefined) {
      requestOptions.body = await encryptBodyByRule(path, options.method, options.body);
    }
    return mtlsRequestJson<T>(path, requestOptions);
  };
  let data: T;
  try {
    data = await send();
  } catch (error) {
    const stale = staleManifest(error);
    if (!stale || !(await refetchClientManifest(stale.latestVersion, stale.environment))) {
      throw error;
    }
    data = await send();
  }
  // Fields the backend encrypted for this device's transit key.
  const keyring = getActiveKeyring();
  return keyring ? ((await decryptTransitFields(data, keyring)) as T) : data;
}

export async function apiGet<T>(path: string, options?: RequestExtras): Promise<T> {
  const requestOptions: MtlsRequestOptions & { token?: string } = {
    method: 'GET',
  };
  if (options?.token !== undefined) {
    requestOptions.token = options.token;
  }
  if (options?.headers !== undefined) {
    requestOptions.headers = options.headers;
  }
  if (options?.signal !== undefined) {
    requestOptions.signal = options.signal;
  }
  if (options?.timeoutMs !== undefined) {
    requestOptions.timeoutMs = options.timeoutMs;
  }
  return apiRequest<T>(path, requestOptions);
}

export async function apiPost<T>(
  path: string,
  body?: MtlsRequestOptions['body'],
  options?: RequestExtras,
): Promise<T> {
  const requestOptions: MtlsRequestOptions & { token?: string } = {
    method: 'POST',
  };
  if (options?.token !== undefined) {
    requestOptions.token = options.token;
  }
  if (options?.headers !== undefined) {
    requestOptions.headers = options.headers;
  }
  if (options?.signal !== undefined) {
    requestOptions.signal = options.signal;
  }
  if (options?.timeoutMs !== undefined) {
    requestOptions.timeoutMs = options.timeoutMs;
  }
  if (body !== undefined) {
    requestOptions.body = body;
  }
  return apiRequest<T>(path, requestOptions);
}

export async function apiPut<T>(
  path: string,
  body?: MtlsRequestOptions['body'],
  options?: RequestExtras,
): Promise<T> {
  const requestOptions: MtlsRequestOptions & { token?: string } = {
    method: 'PUT',
  };
  if (options?.token !== undefined) {
    requestOptions.token = options.token;
  }
  if (options?.headers !== undefined) {
    requestOptions.headers = options.headers;
  }
  if (options?.signal !== undefined) {
    requestOptions.signal = options.signal;
  }
  if (options?.timeoutMs !== undefined) {
    requestOptions.timeoutMs = options.timeoutMs;
  }
  if (body !== undefined) {
    requestOptions.body = body;
  }
  return apiRequest<T>(path, requestOptions);
}

export async function apiGetText(
  path: string,
  options?: RequestExtras,
): Promise<{ data: string; contentType?: string }> {
  const headers = withAuthHeaders(options?.token, options?.headers);
  return mtlsRequestText(path, { method: 'GET', headers });
}

export async function apiPostText(
  path: string,
  options?: RequestExtras,
): Promise<{ data: string; contentType?: string }> {
  const headers = withAuthHeaders(options?.token, options?.headers);
  return mtlsRequestText(path, { method: 'POST', headers });
}

export { isMtlsRequestError, MtlsRequestError };
