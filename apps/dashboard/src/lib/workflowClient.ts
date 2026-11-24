import { createWorkflowClient } from '@xyne/workflow-ui';
import { API_BASE_URL } from '../config';
import { apiFetch } from '../services/clients/apiClient';

/**
 * HTTP client for the workflows surface, mounted at `/api/workflows-v2`.
 *
 * `-v2` is historical: `/api/workflows` was the retired in-house engine's mount;
 * this is the `@xyne/workflow-sdk` one.
 *
 * The SDK client takes a fetch function. It is given `apiFetch`, which runs each call through
 * `apiInstance`, so workflow calls behave like every other dashboard API call: the session cookie,
 * request encryption, response decryption (with API client encryption on, the backend encrypts
 * fields such as a workflow's `metadata`), session refresh. The execution event stream, read with
 * `res.body.getReader()`, goes over fetch with the session cookie.
 *
 * (xyne-search never hits this: it mounts the client on a relative `/v2` behind a vite
 * proxy, which is same-origin and so sends cookies by default.)
 */
export const workflowClient = createWorkflowClient({
  baseUrl: `${API_BASE_URL}/workflows-v2`,
  getHeaders: () => ({}),
  fetch: apiFetch,
});
