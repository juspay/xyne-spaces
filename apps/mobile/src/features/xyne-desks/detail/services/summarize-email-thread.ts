import { apiGetText, isMtlsRequestError } from '@/src/services/apiClient';

export type EmailThreadSummaryResult = {
  summary: string;
  keypoints: string[];
};

type SSECompleteOutput = {
  summary?: string;
  keyPoints?: Array<{ point?: string }>;
};

type SSEEvent = {
  type?: string;
  error?: string;
  output?: SSECompleteOutput;
};

/**
 * Fetch an email-thread AI summary.
 * Backend streams SSE; Lotus waits for the full body (same UX as dashboard —
 * email summary UI only reacts to the `complete` event).
 */
export async function summarizeEmailThread(
  conversationId: string,
  options?: { regenerate?: boolean },
): Promise<EmailThreadSummaryResult> {
  const regenerate = options?.regenerate === true;
  const path = `/summarize/email-thread/${encodeURIComponent(conversationId)}${
    regenerate ? '?regenerate=true' : ''
  }`;

  try {
    const { data } = await apiGetText(path, {
      headers: { Accept: 'text/event-stream' },
    });

    return parseEmailSummarySse(data);
  } catch (error) {
    if (isMtlsRequestError(error)) {
      const message = extractErrorMessage(error.responseBody) || error.message;
      throw new Error(message);
    }
    if (error instanceof Error) throw error;
    throw new Error('Failed to summarize email thread');
  }
}

function parseEmailSummarySse(raw: string): EmailThreadSummaryResult {
  let summary = '';
  let keypoints: string[] = [];
  let sawComplete = false;
  let streamError: string | null = null;

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const event = JSON.parse(line.slice(6)) as SSEEvent;
      if (event.type === 'complete') {
        sawComplete = true;
        summary = event.output?.summary ?? '';
        keypoints =
          event.output?.keyPoints
            ?.map(kp => kp.point?.trim() ?? '')
            .filter(point => point.length > 0) ?? [];
      } else if (event.type === 'error') {
        streamError = event.error || 'Failed to generate summary. Please try again.';
      }
    } catch {
      // Ignore malformed SSE lines
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }

  if (!sawComplete && !summary && keypoints.length === 0) {
    throw new Error('Failed to generate summary. Please try again.');
  }

  return { summary, keypoints };
}

function extractErrorMessage(responseBody: string): string | null {
  if (!responseBody) return null;
  try {
    const parsed = JSON.parse(responseBody) as { error?: string };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Non-JSON body — fall through
  }
  return null;
}
