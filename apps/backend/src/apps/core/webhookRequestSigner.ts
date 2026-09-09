import crypto from 'crypto';

/**
 * Request signer for Xyne → Xyne App API calls (the app is the server).
 *
 * This is the REQUEST-signing scheme — distinct from the body-only webhook
 * scheme of signWebhookPayload (eventSubscriptionUtils.ts), which stays
 * untouched and keeps using X-Xyne-Signature. The signed string is:
 *
 *   `${timestamp}\n${METHOD}\n${pathWithQuery}`
 *
 * HMAC-SHA256 with the app's signingSecret, hex-encoded, in the distinct
 * X-Xyne-Request-Signature header so an app verifier can't confuse the two
 * schemes. The timestamp is epoch seconds in X-Xyne-Timestamp so the app can
 * apply its own replay window. The app's signingSecret is shared.
 */

export const XYNE_TIMESTAMP_HEADER = 'X-Xyne-Timestamp';
export const XYNE_REQUEST_SIGNATURE_HEADER = 'X-Xyne-Request-Signature';
export const XYNE_SOURCE_HEADER = 'X-Source';
export const XYNE_SOURCE_VALUE = 'XyneSpaces';

export interface SignedAppRequestParams {
  /** Plaintext signing secret (decrypt(Apps.signingSecret)). */
  signingSecret: string;
  /** HTTP method; normalized to upper case before signing. */
  method: string;
  /** path + query as seen by the app, e.g. `/export/messages?startDate=...`. */
  pathWithQuery: string;
  /** Epoch seconds. Defaults to now. */
  timestamp?: number;
}

export function signAppRequest(params: SignedAppRequestParams): {
  timestamp: number;
  signature: string;
} {
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  const payload = `${timestamp}\n${params.method.toUpperCase()}\n${params.pathWithQuery}`;
  const signature = crypto
    .createHmac('sha256', params.signingSecret)
    .update(payload)
    .digest('hex');
  return { timestamp, signature };
}

export function buildSignedAppRequestHeaders(
  params: SignedAppRequestParams,
): Record<string, string> {
  const { timestamp, signature } = signAppRequest(params);
  return {
    [XYNE_TIMESTAMP_HEADER]: String(timestamp),
    [XYNE_REQUEST_SIGNATURE_HEADER]: signature,
    [XYNE_SOURCE_HEADER]: XYNE_SOURCE_VALUE,
  };
}
