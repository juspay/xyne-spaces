import { API_BASE_URL } from '@/src/config';
import { apiPost } from '@/src/services/apiClient';
import { openEventStream } from '@/src/services/http/eventStream';
import { prepareHeadersForTransport } from '@/src/utils/mtlsHttpClient';

import type { ConversationRef } from './xyneAIConversations';
import {
  decodeLiveEvent,
  decodeStreamEvent,
  type LiveFrame,
  type PendingAction,
  type XyneAIEvent,
} from './xyneAIEvents';
import { buildStreamRequestBody, type XyneAIStreamRequest } from './xyneAIRequest';

export function streamXyneAI(
  request: XyneAIStreamRequest,
  { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: XyneAIEvent) => void },
): Promise<void> {
  return openEventStream(`${API_BASE_URL}/xyne-ai`, {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildStreamRequestBody(request)),
    signal,
    prepareHeaders: prepareHeadersForTransport,
    onMessage: data => {
      const event = decodeStreamEvent(data);
      if (event) onEvent(event);
    },
  });
}

/** Follows a run this device is not driving, such as one resumed by a pending action. */
export function streamLiveConversation(
  { conversationId, agentSlug }: ConversationRef,
  { signal, onFrame }: { signal: AbortSignal; onFrame: (frame: LiveFrame) => void },
): Promise<void> {
  const path = `/xyne-ai/v2/conversations/${encodeURIComponent(conversationId)}/live`;
  return openEventStream(`${API_BASE_URL}${path}?agentSlug=${encodeURIComponent(agentSlug)}`, {
    signal,
    prepareHeaders: prepareHeadersForTransport,
    onMessage: (data, event) => onFrame(decodeLiveEvent(event, data)),
  });
}

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

export function respondToPendingAction(
  { sessionId, agentSlug }: { sessionId: string; agentSlug: string },
  { id, params, serverType, tool, signature }: PendingAction,
  approved: boolean,
): Promise<unknown> {
  return apiPost('/xyne-ai/v2/action', {
    sessionId,
    agentSlug,
    actionId: id,
    approved,
    params,
    serverType,
    tool,
    signature,
  });
}
