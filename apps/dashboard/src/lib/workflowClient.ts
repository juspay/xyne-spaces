import { createWorkflowClient } from '@xyne/workflow-ui';
import { API_BASE_URL } from '../config';

/**
 * HTTP client for the workflows surface, mounted at `/api/workflows-v2`.
 *
 * `-v2` because `/api/workflows` is the in-house engine's mount; this is the
 * `@xyne/workflow-sdk` one.
 *
 * Auth is the session cookie, the same as every other dashboard API call
 * (`apiClient` sets `withCredentials: true`; the backend reads the token from the
 * cookie rather than an Authorization header) — so `getHeaders` has nothing to add.
 *
 * The cookie does need asking for, though. `createWorkflowClient` never sets
 * `credentials` on its fetch, and in dev the dashboard (:5173) and backend (:3001) are
 * different origins, so the browser's default `same-origin` policy drops the cookie and
 * every call comes back 401. Overriding fetch is the supported way to fix that — the
 * config exposes it precisely for interceptors like this one.
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
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: 'include' }),
});
