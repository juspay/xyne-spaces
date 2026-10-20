import { apiPost } from '@/src/services/apiClient';

import type { JevRoute } from '../navigation/intent';

const ROUTE_TIMEOUT_MS = 2000;

/** Asks the backend's intent classifier which of these app actions a short command is. */
export function routeIntent(
  text: string,
  actions: { id: string; description: string }[],
  signal: AbortSignal,
): Promise<JevRoute> {
  return apiPost<JevRoute>(
    '/assistant/route',
    { text, actions },
    { signal, timeoutMs: ROUTE_TIMEOUT_MS },
  );
}
