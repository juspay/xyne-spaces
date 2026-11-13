/**
 * Parse a webhook body from its raw bytes.
 *
 * The engine does this itself, after authentication, so verification never
 * depends on how the host parsed the request.
 */

export class MalformedBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedBodyError';
  }
}

const decoder = new TextDecoder();

/**
 * JSON for JSON content types, an object of fields for form-encoded bodies,
 * text otherwise. A body with no content type is tried as JSON and falls back
 * to text, since many senders omit the header. An empty body is `{}`.
 *
 * @throws {MalformedBodyError} when a JSON content type carries invalid JSON.
 */
export function parseInboundBody(rawBody: Uint8Array, contentType: string | undefined): unknown {
  if (rawBody.byteLength === 0) return {};
  const text = decoder.decode(rawBody);
  const mediaType = (contentType ?? '').split(';')[0]!.trim().toLowerCase();

  if (mediaType === 'application/json' || mediaType.endsWith('+json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MalformedBodyError('Request body is not valid JSON');
    }
  }
  if (mediaType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (mediaType === '') {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}
