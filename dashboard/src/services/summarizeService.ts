import { BASE_URL } from './clients/apiClient';
import { parseStreamingContent } from '../components/Chat/Summary';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SearchMessageForSummary {
  title: string; // channel name
  subtitle: string; // sender name
  context: string; // message content
  timestamp: string; // ISO date string or readable format
  messageId: string;
  conversationId: string;
  senderId: string | undefined;
}

export interface SummaryStreamCallbacks {
  onStart?: (metadata: {
    messageCount: number;
    participantCount: number;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  }) => void;
  onDelta?: (content: string) => void;
  onComplete?: (data: {
    summary: string;
    keypoints: string[];
    messageIdMapping?: Record<string, string> | undefined;
    conversationIdMapping?: Record<string, string> | undefined;
  }) => void;
  onError?: (error: string) => void;
  onNoMessages?: (message: string) => void;
}

// SSE Event Types for type-safe parsing
interface SSEStartEvent {
  type: 'start';
  messageCount?: number;
  participantCount?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface SSEDeltaEvent {
  type: 'delta';
  content?: string;
}

interface SSECompleteEvent {
  type: 'complete';
  output?: {
    summary?: string;
    keyPoints?: Array<{ point: string }>;
  };
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
}

interface SSEErrorEvent {
  type: 'error';
  error?: string;
}

interface SSENoMessagesEvent {
  type: 'no_messages';
  message?: string;
}

type SSEEvent =
  | SSEStartEvent
  | SSEDeltaEvent
  | SSECompleteEvent
  | SSEErrorEvent
  | SSENoMessagesEvent;

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Summarize search messages via streaming SSE
 */
export async function summarizeSearchMessages(
  searchQuery: string,
  messages: SearchMessageForSummary[],
  callbacks: SummaryStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${BASE_URL}/summarize/searchMessage`;

  try {
    // eslint-disable-next-line local-rules/no-fetch-use-axios
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      credentials: 'include',
      body: JSON.stringify({ searchQuery, messages }),
      ...(signal && { signal }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('No response body');

    let buffer = '';
    let rawContent = '';
    let hasReceivedComplete = false;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (true) {
      if (signal?.aborted) {
        void reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6)) as SSEEvent;

            switch (data.type) {
              case 'start':
                callbacks.onStart?.({
                  messageCount: data.messageCount ?? 0,
                  participantCount: data.participantCount ?? 0,
                  dateFrom: data.dateFrom,
                  dateTo: data.dateTo,
                });
                break;

              case 'delta':
                if (data.content) {
                  rawContent += data.content;
                  callbacks.onDelta?.(data.content);
                }
                break;

              case 'complete': {
                const { summary, keypoints } = parseStreamingContent(rawContent);
                callbacks.onComplete?.({
                  summary: summary || data.output?.summary || '',
                  keypoints:
                    keypoints.length > 0
                      ? keypoints
                      : data.output?.keyPoints?.map((kp: { point: string }) => kp.point) || [],
                  messageIdMapping: data.messageIdMapping,
                  conversationIdMapping: data.conversationIdMapping,
                });
                hasReceivedComplete = true;
                break;
              }

              case 'error':
                callbacks.onError?.(data.error || 'An error occurred');
                break;

              case 'no_messages':
                callbacks.onNoMessages?.(data.message || 'No messages found');
                break;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    // If we didn't get a "complete" event but the stream ended, we should still call onComplete if we have content
    if (!hasReceivedComplete && rawContent) {
      const { summary, keypoints } = parseStreamingContent(rawContent);
      callbacks.onComplete?.({
        summary,
        keypoints,
      });
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    callbacks.onError?.(err instanceof Error ? err.message : 'Failed to summarize');
  }
}
