import { createWorkflowClient } from '@xyne/workflow-ui';
import { API_BASE_URL } from '../config';
import { decryptResponseText } from '../services/encryptionInterceptors';

/**
 * The browser fetch for the workflow client: sends the session cookie and decrypts JSON responses.
 *
 * With API client encryption on, the backend's global response middleware encrypts fields such as
 * a workflow's `metadata` for this browser's transit key (`ENC:v1|tk-…`). The app's axios client
 * decrypts those in its response interceptor; this client is plain fetch, so it does the same here
 * with `decryptResponseText`. Without it the workflow UI gets ciphertext: names fall back to ids and
 * definitions don't parse. Event streams and non-JSON bodies pass through untouched.
 */
async function workflowFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await globalThis.fetch(input, { ...init, credentials: 'include' });

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json') || res.status === 204 || res.status === 304) return res;

  const raw = await res.text();
  const text = await decryptResponseText(raw);
  const headers = new Headers(res.headers);
  if (text !== raw) headers.delete('content-length');
  return new Response(text, { status: res.status, statusText: res.statusText, headers });
}

/**
 * HTTP client for the workflows surface, mounted at `/api/workflows-v2`.
 *
 * `-v2` is historical: `/api/workflows` was the retired in-house engine's mount;
 * this is the `@xyne/workflow-sdk` one.
 *
 * Auth is the session cookie, the same as every other dashboard API call
 * (`apiClient` sets `withCredentials: true`; the backend reads the token from the
 * cookie rather than an Authorization header) — so `getHeaders` has nothing to add.
 *
 * The cookie does need asking for, though. `createWorkflowClient` never sets
 * `credentials` on its fetch, and in dev the dashboard (:5173) and backend (:3001) are
 * different origins, so the browser's default `same-origin` policy drops the cookie and
 * every call comes back 401. Overriding fetch is the supported way to fix that — the
 * config exposes it precisely for interceptors like this one (see `workflowFetch`).
 *
 * (xyne-search never hits this: it mounts the client on a relative `/v2` behind a vite
 * proxy, which is same-origin and so sends cookies by default.)
 */
export const workflowClient = createWorkflowClient({
  baseUrl: `${API_BASE_URL}/workflows-v2`,
  getHeaders: () => ({}),
  // The SDK client is fetch-shaped by contract, and its execution stream is SSE read via
  // `res.body.getReader()` — axios cannot stream in the browser, so this cannot be the app's
  // axios instance. Same reason as liveConversationStream.ts and xyneAIStream.worker.ts.
  fetch: workflowFetch,
});
