/**
 * Shared request-shaping for the two places that send a user-configured webhook
 * from the same config shape: the automations TRIGGER_WEBHOOK step, and the App
 * Desk history fetch (apps/core/appFetchConfig.ts).
 *
 * Kept here rather than on the step class so neither consumer pulls in the
 * other's dependencies — importing the step would drag in safeWebhookFetch and
 * therefore the whole validated env, which would stop appFetchConfig being
 * loadable on its own.
 */

import { decryptHeaderValue } from './webhook-step-encryption';

export type WebhookEncoding = 'JSON' | 'FORM' | 'RAW';

/**
 * Decrypt stored header values and default the Content-Type for the encoding.
 * An explicit Content-Type in the config always wins; RAW sets none, so the
 * caller's own header decides.
 */
export function buildWebhookHeaders(
  headers: Record<string, string> | undefined,
  encoding: WebhookEncoding,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = decryptHeaderValue(v);
  }
  const hasContentType = Object.keys(out).some(k => k.toLowerCase() === 'content-type');
  if (!hasContentType) {
    if (encoding === 'JSON') out['Content-Type'] = 'application/json';
    else if (encoding === 'FORM') out['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  return out;
}

/**
 * JSON object string → form-encoded body. Nested values are JSON-stringified
 * rather than coerced, so an object field does not arrive as "[object Object]".
 * A body that is not a JSON object is passed through untouched.
 */
export function toWebhookFormBody(body: unknown): string {
  if (typeof body !== 'string') return '';
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        usp.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      return usp.toString();
    }
    return body;
  } catch {
    return body;
  }
}
