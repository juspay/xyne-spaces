export interface AskAIErrorInfo {
  /** Absent for failures that never reached a model provider. */
  code: string | undefined;
  title: string;
  message: string;
  helpText: string | undefined;
  /** The backend's own error text, for a "Technical details" disclosure. */
  rawError: string | undefined;
}

const info = (title: string, message: string, helpText?: string): AskAIErrorInfo => ({
  code: undefined,
  title,
  message,
  helpText,
  rawError: undefined,
});

/* eslint-disable @typescript-eslint/naming-convention */
const HTTP_STATUS_ERRORS: Record<number, AskAIErrorInfo> = {
  401: info(
    'Authentication failed',
    'Ask AI could not authenticate with the model provider.',
    'An API key or token for this workspace may be missing, expired, or misconfigured (for example, some providers expect a Bearer prefix). Ask a workspace admin to check the model integration settings.',
  ),
  403: info(
    'Access denied',
    'The model provider refused this request for permission reasons.',
    'Check that your workspace is allowed to use this model and that quotas or policies permit the request.',
  ),
  404: info(
    'Model or resource not found',
    'The model provider reported that a model or endpoint could not be found.',
    'Verify the configured model name and provider endpoint with a workspace administrator.',
  ),
  408: info(
    'Request timed out',
    'The model provider stopped waiting for this request.',
    'Try again with less context or a shorter prompt.',
  ),
  429: info(
    'Rate limit reached',
    'The model provider rate-limited this request.',
    'Wait a moment and try again, or reduce how many concurrent Ask AI requests are running.',
  ),
  500: info(
    'Model provider error',
    'The model provider returned an internal error.',
    'Try again shortly. If it continues, the issue may be on the provider side.',
  ),
  502: info(
    'Bad gateway',
    'Ask AI could not get a valid response from the model service.',
    'Try again in a moment.',
  ),
  503: info(
    'Model service unavailable',
    'The model provider is temporarily unavailable.',
    'Try again shortly.',
  ),
  504: info(
    'Gateway timeout',
    'The model provider took too long to respond.',
    'Try again with less context or a shorter prompt.',
  ),
};
/* eslint-enable @typescript-eslint/naming-convention */

const CONTEXT_TOO_LARGE_TITLE = 'Context too large';
const CONTEXT_TOO_LARGE_MESSAGE = 'This Ask AI request is too large for the current model.';
const CONTEXT_TOO_LARGE_HELP =
  'Try removing some channel context, long thread history, canvas selections, or attachments, then send the query again.';

// Checked in order: the first class with a keyword in the lowercased error wins.
const ERROR_CLASSES: { code: string; keywords: string[]; error: AskAIErrorInfo }[] = [
  {
    code: 'CONTEXT_LIMIT_EXCEEDED',
    keywords: ['contextexceedederror', 'contextwindowexceedederror'],
    error: info(CONTEXT_TOO_LARGE_TITLE, CONTEXT_TOO_LARGE_MESSAGE, CONTEXT_TOO_LARGE_HELP),
  },
  {
    code: 'BUDGET_EXCEEDED',
    keywords: ['budgetexceedederror'],
    error: info(
      'Usage limit reached',
      'Ask AI could not run this request because the usage budget has been exceeded.',
      'Please try again later or use a smaller request if that is supported for your workspace.',
    ),
  },
  {
    code: 'PROXY_ERROR',
    keywords: ['proxyexception'],
    error: info(
      'Model service unavailable',
      'Ask AI could not reach the model service needed to complete this request.',
      'Please try again in a moment.',
    ),
  },
  {
    code: 'INTERNAL_SERVER_ERROR',
    keywords: ['internalservererror'],
    error: info(
      'Server error',
      'Ask AI ran into a server-side error while generating a response.',
      'Please try again shortly.',
    ),
  },
  {
    code: 'MIDSTREAM_FALLBACK_ERROR',
    keywords: ['midstreamfallbackerror'],
    error: info(
      'Response interrupted',
      'Ask AI started processing the request, but recovery failed before the response could finish.',
      'Please retry the same prompt.',
    ),
  },
  {
    code: 'TIMEOUT',
    keywords: ['readtimeout', 'timeout', 'terminated'],
    error: info(
      'Request timed out',
      'Ask AI took too long to complete this request.',
      'Try again, or reduce the amount of context if the request is large.',
    ),
  },
  {
    code: 'BAD_REQUEST',
    keywords: ['badrequesterror', 'httpexception'],
    error: info(
      'Request could not be processed',
      'Ask AI could not process this request with the current model configuration.',
      'Try simplifying the prompt or reducing the attached context, then retry.',
    ),
  },
  {
    code: 'LLM_ERROR',
    keywords: ['basellmexception'],
    error: info(
      'Model error',
      'The AI model returned an error while processing this request.',
      'Please try again.',
    ),
  },
  {
    code: 'ASSERTION_ERROR',
    keywords: ['assertionerror'],
    error: info(
      'Internal validation error',
      'Ask AI hit an internal validation error while processing this request.',
      'Please retry. If it keeps happening, reduce the request context and try again.',
    ),
  },
  {
    code: 'TYPE_ERROR',
    keywords: ['typeerror'],
    error: info(
      'Internal processing error',
      'Ask AI hit an internal formatting error while processing this request.',
      'Please retry the request.',
    ),
  },
  {
    code: 'EXCEPTION',
    keywords: ['exception'],
    error: info(
      "Ask AI couldn't complete this request",
      'Ask AI ran into an internal error while generating a response.',
      'Please try again.',
    ),
  },
  {
    code: 'NETWORK_ERROR',
    keywords: ['fetch failed', 'econnrefused', 'networkerror'],
    error: info(
      'Network error',
      "Couldn't connect to the AI model service.",
      'This usually means the model service is unreachable. Check that the service is running and try again.',
    ),
  },
];

const CONTEXT_LIMIT_PHRASES = [
  'context length',
  'maximum input length',
  'input_tokens',
  'input tokens',
];

/** Providers embed the status in the error text, e.g. `[401]` or `{"code":"429"}`. */
function statusFromText(text: string): number | undefined {
  const code =
    /"code"\s*:\s*"?(\d{3})\b/.exec(text)?.[1] ??
    /\\"code\\"\s*:\s*\\"(\d{3})\\"/.exec(text)?.[1] ??
    /\[(\d{3})\]/.exec(text)?.[1];
  if (code) return Number(code);
  return /\\?"type\\?"\s*:\s*\\?"auth_error\\?"/i.test(text) ? 401 : undefined;
}

const formatCount = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : Number(value).toLocaleString('en-US');

function contextLimitMessage(text: string): string {
  const sent = formatCount(/passed\s+(\d+)\s+input tokens/i.exec(text)?.[1]);
  const max = formatCount(/context length is only\s+(\d+)/i.exec(text)?.[1]);
  return sent && max
    ? `${CONTEXT_TOO_LARGE_MESSAGE} This request sent about ${sent} input tokens, but the current model supports up to ${max}.`
    : CONTEXT_TOO_LARGE_MESSAGE;
}

function classify(text: string, httpStatus: number | undefined): AskAIErrorInfo {
  const lowered = text.toLowerCase();
  const status =
    httpStatus !== undefined && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : statusFromText(text);

  if (status !== undefined) {
    return {
      ...(HTTP_STATUS_ERRORS[status] ??
        info(
          'Request failed',
          `Ask AI received an error from the model provider (HTTP ${status}).`,
          'Try again. If this keeps happening, reduce context or contact a workspace administrator.',
        )),
      code: `HTTP_${status}`,
    };
  }
  if (CONTEXT_LIMIT_PHRASES.some(phrase => lowered.includes(phrase))) {
    return {
      ...info(CONTEXT_TOO_LARGE_TITLE, contextLimitMessage(text), CONTEXT_TOO_LARGE_HELP),
      code: 'CONTEXT_LIMIT_EXCEEDED',
    };
  }
  const matched = ERROR_CLASSES.find(({ keywords }) =>
    keywords.some(keyword => lowered.includes(keyword)),
  );
  return (
    (matched && { ...matched.error, code: matched.code }) ??
    info(
      "Ask AI couldn't complete this request",
      text || 'Something went wrong while generating a response.',
      'Please try again. If this keeps happening, reduce the amount of context and retry.',
    )
  );
}

export function getAskAIErrorInfo(
  rawError: string | undefined,
  httpStatus: number | undefined,
): AskAIErrorInfo {
  return { ...classify(rawError ?? '', httpStatus), rawError: rawError || undefined };
}

/**
 * The request itself failed, so no model provider is involved: a 401 means the
 * user's own session ended, and no status at all means the device is offline.
 */
export function getTransportErrorInfo(httpStatus: number | undefined): AskAIErrorInfo {
  if (httpStatus === 401) {
    return info('Session expired', 'Your session expired. Sign in again.');
  }
  if (httpStatus === undefined) {
    return info('No connection', "Can't reach Xyne. Check your connection.");
  }
  return getAskAIErrorInfo(undefined, httpStatus);
}
