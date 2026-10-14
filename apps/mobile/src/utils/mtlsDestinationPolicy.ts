function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Returns true only for destinations that are allowed to receive app transport
 * credentials and/or the device client certificate.
 *
 * The API origin is compared as an exact origin (scheme, host and port). Local
 * development may use an arbitrary loopback port, but never a non-loopback
 * cleartext host. Paths, queries and fragments do not change the decision.
 */
export function isApprovedTransportDestination(url: string, expectedApiOrigin: string): boolean {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl || parsedUrl.username || parsedUrl.password) {
    return false;
  }

  if (isLoopbackHost(parsedUrl.hostname)) {
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  }

  const apiOrigin = parseUrl(expectedApiOrigin);
  return apiOrigin !== null && parsedUrl.origin === apiOrigin.origin;
}

/**
 * WebSocket counterpart of isApprovedTransportDestination. The API is configured as HTTPS,
 * while the WebSocket transport uses WSS; compare their origins after normalizing that scheme.
 */
export function isApprovedWebSocketDestination(url: string, expectedApiOrigin: string): boolean {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl || parsedUrl.username || parsedUrl.password) {
    return false;
  }

  if (isLoopbackHost(parsedUrl.hostname)) {
    return parsedUrl.protocol === 'ws:' || parsedUrl.protocol === 'wss:';
  }

  if (parsedUrl.protocol !== 'wss:') {
    return false;
  }

  const apiOrigin = parseUrl(expectedApiOrigin);
  if (!apiOrigin || apiOrigin.protocol !== 'https:') {
    return false;
  }

  return `https://${parsedUrl.host}` === apiOrigin.origin;
}
