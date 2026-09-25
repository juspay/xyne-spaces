/**
 * Network half of the App Desk history pull, split from appFetchConfig so that
 * module stays pure (no fetch, no db) and unit-testable.
 *
 * Both callers of the export API go through here — the refetch loop and the
 * "test fetch" the config screen runs — so host rewriting, the SSRF guard and
 * the timeout can never drift between what an operator tests and what the
 * worker actually sends.
 */

import { isInternalMappedHost, prepareAppWebhookDispatch } from './appUrlResolver';
import { safeWebhookFetch } from '@/utils/ssrfGuard';
import type { SignedFetchRequest } from './appFetchConfig';

/**
 * Largest export page Xyne will read.
 */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export class AppFetchResponseTooLargeError extends Error {
  constructor(bytes: number | null) {
    super(
      `export response exceeds the ${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)}MB limit` +
        (bytes === null ? '' : ` (${bytes} bytes)`),
    );
    this.name = 'AppFetchResponseTooLargeError';
  }
}

/**
 * Read a response body with a hard byte ceiling, aborting the stream as soon as
 * it is exceeded rather than buffering the whole thing first.
 */
export async function readCappedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new AppFetchResponseTooLargeError(declared);
  }
  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppFetchResponseTooLargeError(null);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class AppFetchForbiddenHostError extends Error {
  constructor(host: string) {
    super(
      `"${host}" is an internal service host and cannot be used as a history fetch URL`,
    );
    this.name = 'AppFetchForbiddenHostError';
  }
}

export async function dispatchAppFetch(
  request: SignedFetchRequest,
  timeoutMs: number,
): Promise<Response> {
  const requestHost = (() => {
    try {
      return new URL(request.url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (requestHost && isInternalMappedHost(requestHost)) {
    throw new AppFetchForbiddenHostError(requestHost);
  }

  const dispatch = await prepareAppWebhookDispatch(
    request.url,
    request.init.headers as Record<string, string>,
  );
  const init: RequestInit = {
    ...request.init,
    headers: dispatch.headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
  // Internal pod hosts resolve to private addresses by design, so they bypass
  // the guard that exists to keep external URLs off the internal network.
  return dispatch.isInternal
    ? await fetch(dispatch.url, init)
    : await safeWebhookFetch(dispatch.url, init);
}
