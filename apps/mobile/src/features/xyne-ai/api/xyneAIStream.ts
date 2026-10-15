import { API_BASE_URL } from '@/src/config';
import { apiPost } from '@/src/services/apiClient';
import { openEventStream } from '@/src/services/http/eventStream';
import { prepareHeadersForTransport } from '@/src/utils/mtlsHttpClient';

import { decodeStreamEvent, type XyneAIEvent } from './xyneAIEvents';
import { buildStreamRequestBody, type XyneAIStreamRequest } from './xyneAIRequest';

export function streamXyneAI(
  request: XyneAIStreamRequest,
  { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: XyneAIEvent) => void },
): Promise<void> {
  return openEventStream(`${API_BASE_URL}/xyne-ai`, {
    method: 'POST',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildStreamRequestBody(request)),
    signal,
    prepareHeaders: prepareHeadersForTransport,
    onMessage: ({ data }) => {
      const event = decodeStreamEvent(data);
      if (event) onEvent(event);
    },
  });
}

/** Asks the server to stop the agent run behind a stream; the caller still aborts locally. */
export function cancelXyneAI(traceId: string): Promise<unknown> {
  return apiPost(`/xyne-ai/v2/cancel/${encodeURIComponent(traceId)}`);
}

export type Rating = 'up' | 'down';

export function rateXyneAIMessage(
  messageId: string,
  rating: Rating,
  comment?: string,
): Promise<unknown> {
  return apiPost(`/xyne-ai/v2/messages/${encodeURIComponent(messageId)}/rate`, {
    rating,
    ...(comment && { comment }),
  });
}
