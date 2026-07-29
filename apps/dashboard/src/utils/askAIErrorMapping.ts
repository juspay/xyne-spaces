import type { Message } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

function formatTokenCount(value?: string): string | null {
  if (!value) return null;

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return null;

  return parsedValue.toLocaleString('en-US');
}

interface AskAIErrorInfo {
  code: string;
  title: string;
  message: string;
  helpText?: string;
  retryable: boolean;
}

/** Infer HTTP status from provider error strings (e.g. `[401]`, trailing JSON `"code":"401"`). */
export function parseHttpStatusFromErrorString(errorText: string): number | undefined {
  if (!errorText) return undefined;
  return parseHttpStatusFromDetailText(errorText);
}

function parseHttpStatusFromDetailText(detail: string): number | undefined {
  if (!detail) return undefined;
  const quoted = detail.match(/"code"\s*:\s*"(\d{3})"/)?.[1];
  if (quoted) return parseInt(quoted, 10);
  const numeric = detail.match(/"code"\s*:\s*(\d{3})\b/)?.[1];
  if (numeric) return parseInt(numeric, 10);
  // Same string as in raw SSE after JSON.parse — inner quotes may still be backslash-escaped.
  const escapedQuoted = detail.match(/\\"code\\"\s*:\s*\\"(\d{3})\\"/)?.[1];
  if (escapedQuoted) return parseInt(escapedQuoted, 10);
  const bracket = detail.match(/\[(\d{3})\]/)?.[1];
  if (bracket) return parseInt(bracket, 10);
  if (
    /"type"\s*:\s*"auth_error"/i.test(detail) ||
    /\\"type\\"\s*:\s*\\"auth_error\\"/i.test(detail)
  ) {
    return 401;
  }
  return undefined;
}

const HTTP_STATUS_ERROR_MAP: Record<
  number,
  Pick<AskAIErrorInfo, 'code' | 'title' | 'message' | 'helpText' | 'retryable'>
> = {
  401: {
    code: 'HTTP_401',
    title: 'Authentication failed',
    message: 'Ask AI could not authenticate with the model provider.',
    helpText:
      'An API key or token for this workspace may be missing, expired, or misconfigured (for example, some providers expect a Bearer prefix). Ask a workspace admin to check the model integration settings.',
    retryable: false,
  },
  403: {
    code: 'HTTP_403',
    title: 'Access denied',
    message: 'The model provider refused this request for permission reasons.',
    helpText:
      'Check that your workspace is allowed to use this model and that quotas or policies permit the request.',
    retryable: false,
  },
  404: {
    code: 'HTTP_404',
    title: 'Model or resource not found',
    message: 'The model provider reported that a model or endpoint could not be found.',
    helpText:
      'Verify the configured model name and provider endpoint with a workspace administrator.',
    retryable: false,
  },
  408: {
    code: 'HTTP_408',
    title: 'Request timed out',
    message: 'The model provider stopped waiting for this request.',
    helpText: 'Try again with less context or a shorter prompt.',
    retryable: true,
  },
  429: {
    code: 'HTTP_429',
    title: 'Rate limit reached',
    message: 'The model provider rate-limited this request.',
    helpText:
      'Wait a moment and try again, or reduce how many concurrent Ask AI requests are running.',
    retryable: true,
  },
  500: {
    code: 'HTTP_500',
    title: 'Model provider error',
    message: 'The model provider returned an internal error.',
    helpText: 'Try again shortly. If it continues, the issue may be on the provider side.',
    retryable: true,
  },
  502: {
    code: 'HTTP_502',
    title: 'Bad gateway',
    message: 'Ask AI could not get a valid response from the model service.',
    helpText: 'Try again in a moment.',
    retryable: true,
  },
  503: {
    code: 'HTTP_503',
    title: 'Model service unavailable',
    message: 'The model provider is temporarily unavailable.',
    helpText: 'Try again shortly.',
    retryable: true,
  },
  504: {
    code: 'HTTP_504',
    title: 'Gateway timeout',
    message: 'The model provider took too long to respond.',
    helpText: 'Try again with less context or a shorter prompt.',
    retryable: true,
  },
};

interface ErrorClassMapping extends AskAIErrorInfo {
  keywords: string[];
}

const ERROR_CLASS_MAPPINGS: ErrorClassMapping[] = [
  {
    keywords: ['contextexceedederror', 'contextwindowexceedederror'],
    code: 'CONTEXT_LIMIT_EXCEEDED',
    title: 'Context too large',
    message: 'This Ask AI request is too large for the current model.',
    helpText:
      'Try removing some channel context, long thread history, canvas selections, or attachments, then send the query again.',
    retryable: true,
  },
  {
    keywords: ['budgetexceedederror'],
    code: 'BUDGET_EXCEEDED',
    title: 'Usage limit reached',
    message: 'Ask AI could not run this request because the usage budget has been exceeded.',
    helpText:
      'Please try again later or use a smaller request if that is supported for your workspace.',
    retryable: true,
  },
  {
    keywords: ['proxyexception'],
    code: 'PROXY_ERROR',
    title: 'Model service unavailable',
    message: 'Ask AI could not reach the model service needed to complete this request.',
    helpText: 'Please try again in a moment.',
    retryable: true,
  },
  {
    keywords: ['internalservererror'],
    code: 'INTERNAL_SERVER_ERROR',
    title: 'Server error',
    message: 'Ask AI ran into a server-side error while generating a response.',
    helpText: 'Please try again shortly.',
    retryable: true,
  },
  {
    keywords: ['midstreamfallbackerror'],
    code: 'MIDSTREAM_FALLBACK_ERROR',
    title: 'Response interrupted',
    message:
      'Ask AI started processing the request, but recovery failed before the response could finish.',
    helpText: 'Please retry the same prompt.',
    retryable: true,
  },
  {
    keywords: ['readtimeout', 'timeout', 'terminated'],
    code: 'TIMEOUT',
    title: 'Request timed out',
    message: 'Ask AI took too long to complete this request.',
    helpText: 'Try again, or reduce the amount of context if the request is large.',
    retryable: true,
  },
  {
    keywords: ['badrequesterror', 'httpexception'],
    code: 'BAD_REQUEST',
    title: 'Request could not be processed',
    message: 'Ask AI could not process this request with the current model configuration.',
    helpText: 'Try simplifying the prompt or reducing the attached context, then retry.',
    retryable: true,
  },
  {
    keywords: ['basellmexception'],
    code: 'LLM_ERROR',
    title: 'Model error',
    message: 'The AI model returned an error while processing this request.',
    helpText: 'Please try again.',
    retryable: true,
  },
  {
    keywords: ['assertionerror'],
    code: 'ASSERTION_ERROR',
    title: 'Internal validation error',
    message: 'Ask AI hit an internal validation error while processing this request.',
    helpText: 'Please retry. If it keeps happening, reduce the request context and try again.',
    retryable: true,
  },
  {
    keywords: ['typeerror'],
    code: 'TYPE_ERROR',
    title: 'Internal processing error',
    message: 'Ask AI hit an internal formatting error while processing this request.',
    helpText: 'Please retry the request.',
    retryable: true,
  },
  {
    keywords: ['exception'],
    code: 'EXCEPTION',
    title: "Ask AI couldn't complete this request",
    message: 'Ask AI ran into an internal error while generating a response.',
    helpText: 'Please try again.',
    retryable: true,
  },
  {
    keywords: ['fetch failed', 'econnrefused', 'networkerror'],
    code: 'NETWORK_ERROR',
    title: 'Network error',
    message: "Couldn't connect to the AI model service.",
    helpText:
      'This usually means the model service is unreachable. Check that the service is running and try again.',
    retryable: true,
  },
];

export function getAskAIErrorInfo(
  rawError?: string,
  httpStatusFromServer?: number,
): NonNullable<Message['errorInfo']> {
  const errorText = typeof rawError === 'string' ? rawError : '';
  const normalizedError = errorText.toLowerCase();

  const resolvedStatus =
    typeof httpStatusFromServer === 'number' &&
    httpStatusFromServer >= 100 &&
    httpStatusFromServer <= 599
      ? httpStatusFromServer
      : parseHttpStatusFromDetailText(errorText);

  if (resolvedStatus !== undefined) {
    const mapped = HTTP_STATUS_ERROR_MAP[resolvedStatus];
    if (mapped) {
      return {
        code: mapped.code,
        title: mapped.title,
        message: mapped.message,
        retryable: mapped.retryable,
        ...(mapped.helpText !== undefined && { helpText: mapped.helpText }),
        ...(errorText && { rawError: errorText }),
      };
    }
    return {
      code: `HTTP_${resolvedStatus}`,
      title: 'Request failed',
      message: `Ask AI received an error from the model provider (HTTP ${resolvedStatus}).`,
      helpText:
        'Try again. If this keeps happening, reduce context or contact a workspace administrator.',
      retryable: resolvedStatus >= 500 || resolvedStatus === 429,
      ...(errorText && { rawError: errorText }),
    };
  }

  const isContextLimitError =
    normalizedError.includes('context length') ||
    normalizedError.includes('maximum input length') ||
    normalizedError.includes('input_tokens') ||
    normalizedError.includes('input tokens');

  if (isContextLimitError) {
    const inputTokens = formatTokenCount(errorText.match(/passed\s+(\d+)\s+input tokens/i)?.[1]);
    const maxTokens = formatTokenCount(errorText.match(/context length is only\s+(\d+)/i)?.[1]);

    const tokenSummary =
      inputTokens && maxTokens
        ? ` This request sent about ${inputTokens} input tokens, but the current model supports up to ${maxTokens}.`
        : '';

    return {
      code: 'CONTEXT_LIMIT_EXCEEDED',
      title: 'Context too large',
      message: `This Ask AI request is too large for the current model.${tokenSummary}`,
      helpText:
        'Try removing some channel context, long thread history, canvas selections, or attachments, then send the query again.',
      retryable: true,
      ...(errorText && { rawError: errorText }),
    };
  }

  const matchedErrorClass = ERROR_CLASS_MAPPINGS.find(({ keywords }) =>
    keywords.some(keyword => normalizedError.includes(keyword)),
  );

  if (matchedErrorClass) {
    return {
      code: matchedErrorClass.code,
      title: matchedErrorClass.title,
      message: matchedErrorClass.message,
      retryable: matchedErrorClass.retryable,
      ...(matchedErrorClass.helpText !== undefined && { helpText: matchedErrorClass.helpText }),
      ...(errorText && { rawError: errorText }),
    };
  }

  return {
    code: 'UNKNOWN',
    title: "Ask AI couldn't complete this request",
    message: errorText || 'Something went wrong while generating a response.',
    helpText: 'Please try again. If this keeps happening, reduce the amount of context and retry.',
    retryable: true,
    ...(errorText && { rawError: errorText }),
  };
}
