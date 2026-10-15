import {
  isMtlsRequestError,
  MtlsRequestError,
  MtlsRequestOptions,
  mtlsRequestJson,
  mtlsRequestText,
} from './MtlsApiService';

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
  if (options?.body !== undefined) {
    requestOptions.body = options.body;
  }
  return mtlsRequestJson<T>(path, requestOptions);
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
