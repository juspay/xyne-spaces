import axios, { type AxiosResponse } from 'axios';
import { createWorkflowClient } from '@xyne/workflow-ui';
import { API_BASE_URL } from '../config';
import { apiInstance } from '../services/clients/apiClient';

/**
 * The fetch the workflow SDK client is given: a fetch-shaped adapter over `apiInstance`.
 *
 * `createWorkflowClient` takes a fetch function, but the workflow screens' calls should behave like
 * every other dashboard API call. So each one goes through `apiInstance` and its interceptors: the
 * session cookie, request encryption and response decryption (with API client encryption on, the
 * backend encrypts fields such as a workflow's `metadata`), session refresh on 401, and metrics.
 * The axios response is then handed back to the SDK as a `Response`.
 *
 * Event streams are the exception. The SDK reads them with `res.body.getReader()`, which
 * `apiInstance` cannot provide in the browser, so they use fetch with the session cookie. The
 * backend writes them with `res.write`, which its response encryption does not touch.
 */
async function workflowFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  const headers = new Headers(init.headers);

  if ((headers.get('accept') ?? '').includes('text/event-stream')) {
    // eslint-disable-next-line local-rules/no-fetch-use-axios
    return globalThis.fetch(url, { ...init, credentials: 'include' });
  }

  // The SDK builds full URLs from its baseUrl; apiInstance adds API_BASE_URL itself, and its
  // encryption manifest matches the path below it, as for any other caller.
  const path = url.startsWith(API_BASE_URL) ? url.slice(API_BASE_URL.length) : url;
  const isJsonBody =
    typeof init.body === 'string' && (headers.get('content-type') ?? '').includes('application/json');

  try {
    const response = await apiInstance.request<unknown>({
      url: path,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      // A parsed body, so the request interceptor can encrypt it like any other call's.
      data: isJsonBody ? (JSON.parse(init.body as string) as unknown) : init.body,
      ...(init.signal ? { signal: init.signal } : {}),
    });
    return toFetchResponse(response.status, response.data, response);
  } catch (error) {
    // The SDK reads a failed call's status and body itself, as from fetch. apiInstance's error
    // interceptor rejects HTTP errors as an Error carrying `status` (and `responseData`, the body,
    // when it named an error); anything without a status (network failure, abort) is rethrown.
    if (axios.isAxiosError(error) && error.response) {
      return toFetchResponse(error.response.status, error.response.data, error.response);
    }
    const failed = error as { status?: unknown; responseData?: unknown; message?: unknown };
    if (typeof failed.status !== 'number') throw error;
    return toFetchResponse(failed.status, failed.responseData ?? { error: String(failed.message ?? '') });
  }
}

function toFetchResponse(status: number, data: unknown, source?: AxiosResponse<unknown>): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries((source?.headers ?? {}) as Record<string, unknown>)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  headers.delete('content-length');
  const statusText = source?.statusText ?? '';

  const empty = status === 204 || status === 304 || data === undefined || data === null || data === '';
  if (empty) return new Response(null, { status, statusText, headers });
  if (typeof data === 'string') return new Response(data, { status, statusText, headers });
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), { status, statusText, headers });
}

/**
 * HTTP client for the workflows surface, mounted at `/api/workflows-v2`.
 *
 * `-v2` is historical: `/api/workflows` was the retired in-house engine's mount;
 * this is the `@xyne/workflow-sdk` one.
 *
 * Auth is the session cookie, as for every other dashboard API call: `apiInstance` sends it
 * (`withCredentials`), and the event-stream fetch asks for it with `credentials: 'include'`.
 * Without that, in dev the dashboard (:5173) and backend (:3001) are different origins and every
 * call comes back 401.
 *
 * (xyne-search never hits this: it mounts the client on a relative `/v2` behind a vite
 * proxy, which is same-origin and so sends cookies by default.)
 */
export const workflowClient = createWorkflowClient({
  baseUrl: `${API_BASE_URL}/workflows-v2`,
  getHeaders: () => ({}),
  fetch: workflowFetch,
});
