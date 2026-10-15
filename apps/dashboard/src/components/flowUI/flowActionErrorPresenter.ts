import {
  FLOW_ACTION_ERROR_DEFAULT_MESSAGES,
  isFlowActionErrorCode,
  isRetryableFlowActionError,
  type FlowActionErrorCode,
} from '@xyne/shared';

/**
 * What the user sees when a Flow UI card action fails (XYNE-66467).
 *
 * The SERVER decides the error code (it is the only layer that still knows the
 * upstream HTTP status); this module only decides presentation: which text to
 * show and whether a Retry button makes sense. Never pattern-match error text
 * here — an unknown or missing code falls back to INTERNAL.
 */
export interface PresentedFlowActionError {
  code: FlowActionErrorCode;
  text: string;
  retryable: boolean;
}

interface FlowActionErrorLike {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
}

function looksLikeRawJson(text: string): boolean {
  return /[{[]\s*"/.test(text) || /App backend error \d{3}/i.test(text);
}

/** Present a `{ type: 'error', code?, message, retryable? }` AppActionResponse or error envelope. */
export function presentFlowActionError(
  err: FlowActionErrorLike,
  fallbackText?: string,
): PresentedFlowActionError {
  const code: FlowActionErrorCode = isFlowActionErrorCode(err.code) ? err.code : 'INTERNAL';
  const serverText = typeof err.message === 'string' ? err.message.trim() : '';
  // Never show nested JSON or the old "App backend error N" wrapper verbatim.
  const usable = serverText && !looksLikeRawJson(serverText) ? serverText : '';
  // A card author's own `errorMessage` only replaces the generic/unclassified
  // case — it must never hide a specific cause like PERMISSION_DENIED.
  const text =
    code === 'INTERNAL' && fallbackText
      ? fallbackText
      : usable || FLOW_ACTION_ERROR_DEFAULT_MESSAGES[code];
  const retryable =
    typeof err.retryable === 'boolean' ? err.retryable : isRetryableFlowActionError(code);
  return { code, text, retryable };
}

/**
 * Pull a typed error out of something thrown by the API client. The axios
 * interceptor attaches the original response body as `responseData`.
 */
export function presentThrownFlowActionError(
  error: unknown,
  fallbackText?: string,
): PresentedFlowActionError {
  const data = (error as { responseData?: unknown } | null)?.responseData;
  if (data && typeof data === 'object') {
    const body = data as FlowActionErrorLike;
    if (body.code !== undefined || typeof body.message === 'string') {
      return presentFlowActionError(body, fallbackText);
    }
  }
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message : undefined;
  // No HTTP response at all (network down) is the retryable case.
  if (status === undefined && error instanceof Error && /network/i.test(error.message)) {
    return presentFlowActionError({ code: 'UPSTREAM_UNAVAILABLE' });
  }
  return presentFlowActionError({ message }, fallbackText);
}
