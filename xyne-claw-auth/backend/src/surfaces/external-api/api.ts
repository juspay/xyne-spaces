/**
 * The one door to outbound integrator HTTP. Every call this surface makes to a
 * caller-supplied URL goes through postExternalCallback(), which owns headers,
 * body signing, timeout, redirect policy, and status classification.
 * `fetch` must not appear anywhere else in surfaces/external-api/.
 *
 * Deliberate deviation from surfaces/slack/api.ts: this RETURNS an outcome
 * instead of throwing. A thrown fetch error can carry the request headers —
 * which include the integrator's callback secret — so the underlying error is
 * never propagated, wrapped, or logged. Callers get a CallbackOutcome instead.
 */
import { createHmac } from "node:crypto";
import {
  CALLBACK_TIMEOUT_MS,
  RETRYABLE_STATUSES,
  RETRYABLE_STATUS_MIN,
} from "./const.js";

/**
 * Result of a single callback attempt.
 * `networkFailure` carries no detail by design — see the secret-leak note above.
 */
export type CallbackOutcome =
  | { kind: "delivered"; httpStatus: number }
  | { kind: "rejected"; httpStatus: number; retryable: boolean }
  | { kind: "networkFailure" };

/** Transient server-side or throttling failures are worth another attempt. */
function isRetryableStatus(status: number): boolean {
  return status >= RETRYABLE_STATUS_MIN || RETRYABLE_STATUSES.has(status);
}

/** `sha256=<hex>` HMAC over the exact bytes sent, so integrators can verify. */
export function signCallbackBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function postExternalCallback(input: {
  url: string;
  /** Pre-serialized JSON. Signed verbatim so the integrator verifies the bytes
   *  we actually sent, not a re-serialization of them. */
  body: string;
  /** Caller-provided callback secret. Never the internal claw/auth S2S key. */
  secret?: string;
  timeoutMs?: number;
}): Promise<CallbackOutcome> {
  const signature = input.secret !== undefined
    ? signCallbackBody(input.body, input.secret)
    : undefined;

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.secret !== undefined ? { "x-s2s-key": input.secret } : {}),
        ...(signature ? { "x-claw-signature": signature } : {}),
      },
      body: input.body,
      // Never follow redirects: a redirect could bounce an allow-listed host to
      // an internal one, defeating the SSRF gate applied before this call.
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs ?? CALLBACK_TIMEOUT_MS),
    });

    if (response.ok) return { kind: "delivered", httpStatus: response.status };
    return {
      kind: "rejected",
      httpStatus: response.status,
      retryable: isRetryableStatus(response.status),
    };
  } catch {
    // Invariant: swallow the error object entirely. Some fetch implementations
    // attach request headers to it, which would expose the callback secret.
    return { kind: "networkFailure" };
  }
}
