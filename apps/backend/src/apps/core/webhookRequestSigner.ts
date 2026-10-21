import crypto from 'crypto';

/**
 * Request signer for Xyne → Xyne App API calls (the app is the server).
 *
 * This is the REQUEST-signing scheme — distinct from the body-only webhook
 * scheme of signWebhookPayload (eventSubscriptionUtils.ts), which stays
 * untouched and keeps using X-Xyne-Signature. The signed string is:
 *
 *   `${timestamp}\n${METHOD}\n${host}\n${pathWithQuery}\n${installedAppId}\n${channelId}\n${sha256Hex(body)}`
 *
 * The body hash is the last line and is the hash of the empty string for a
 * bodyless request. It binds the payload to the signature: an export request's
 * body carries the channel id and the date window, so signing only the path
 * would let a captured request be replayed against a different channel inside
 * the skew window. Method and path stay in the string too, so a body cannot be
 * replayed against a different endpoint either.
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
export const XYNE_INSTALLED_APP_HEADER = 'X-Xyne-Installed-App-Id';
export const XYNE_CHANNEL_HEADER = 'X-Xyne-Channel-Id';

export interface SignedAppRequestParams {
  /** Plaintext signing secret (decrypt(Apps.signingSecret)). */
  signingSecret: string;
  /** HTTP method; normalized to upper case before signing. */
  method: string;
  /** path + query as seen by the app, e.g. `/export/messages?startDate=...`. */
  pathWithQuery: string;
  /** Hex SHA-256 of the raw request body; the empty-string hash when bodyless. */
  bodyHash: string;
  /** Destination host (with port), as `URL.host`. Binds the signature to where it was sent. */
  host: string;
  /** The install Xyne is acting for. Server-derived; never read from the config. */
  installedAppId: string;
  /** The desk channel the export is for. Server-derived; never read from the config. */
  channelId: string;
  /** Epoch seconds. Defaults to now. */
  timestamp?: number;
}

export function signAppRequest(params: SignedAppRequestParams): {
  timestamp: number;
  signature: string;
} {
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  const payload = [
    timestamp,
    params.method.toUpperCase(),
    params.host,
    params.pathWithQuery,
    params.installedAppId,
    params.channelId,
    params.bodyHash,
  ].join('\n');
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
    [XYNE_INSTALLED_APP_HEADER]: params.installedAppId,
    [XYNE_CHANNEL_HEADER]: params.channelId,
  };
}
