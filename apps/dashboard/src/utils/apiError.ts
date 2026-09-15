/**
 * Extracts a human-readable message from an error thrown by the REST layer.
 * Prefers the backend's error envelope — `{ error }` (used by the ticket
 * controller) or `{ message }` (axios `error.response.data`) — then a plain
 * `Error.message`, then a raw string, falling back to `fallback`.
 */
export function getApiErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  const data = (err as { response?: { data?: { error?: unknown; message?: unknown } } } | null)
    ?.response?.data;
  const apiError = data?.error;
  if (typeof apiError === 'string' && apiError.length > 0) return apiError;
  const apiMessage = data?.message;
  if (typeof apiMessage === 'string' && apiMessage.length > 0) return apiMessage;
  if (typeof err === 'string' && err.length > 0) return err;
  if (err instanceof Error && err.message.length > 0) return err.message;
  return fallback;
}
