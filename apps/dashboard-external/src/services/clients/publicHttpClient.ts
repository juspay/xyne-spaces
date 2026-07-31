import type { HttpClient } from "@xyne/shared/hooks";
import { API_BASE_URL } from "@/config";

const CAC_CONFIG_PATH_PREFIX = "/cac-config/";

interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
}

interface RequestSignal {
  signal?: AbortSignal;
  dispose: () => void;
}

function createRequestSignal(options?: RequestOptions): RequestSignal {
  if (options?.timeout === undefined) {
    return { signal: options?.signal, dispose: () => {} };
  }

  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(options.signal?.reason);

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = window.setTimeout(() => controller.abort(), options.timeout);

  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function getPublicUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function getUnavailableCacConfig<T>(path: string): T {
  return {
    key: path.slice(CAC_CONFIG_PATH_PREFIX.length),
    config: null,
  } as T;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  // CAC is authenticated dashboard configuration. The public call app uses each
  // hook's checked-in fallback instead of issuing a request that cannot succeed.
  if (method === "GET" && path.startsWith(CAC_CONFIG_PATH_PREFIX)) {
    return getUnavailableCacConfig<T>(path);
  }

  const requestSignal = createRequestSignal(options);
  try {
    const response = await fetch(getPublicUrl(path), {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal.signal,
    });

    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    requestSignal.dispose();
  }
}

export const publicHttpClient: HttpClient = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>("POST", path, body, options),
};
