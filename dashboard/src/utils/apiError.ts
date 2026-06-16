/**
 * Extracts a human-readable message from an error thrown by the REST layer.
 * Prefers the backend's `{ message }` envelope (axios `error.response.data.message`),
 * then a plain `Error.message`, then a raw string, falling back to `fallback`.
 */
export function getApiErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  const apiMessage = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data
    ?.message;
  if (typeof apiMessage === 'string' && apiMessage.length > 0) return apiMessage;
  if (typeof err === 'string' && err.length > 0) return err;
  if (err instanceof Error && err.message.length > 0) return err.message;
  return fallback;
}
