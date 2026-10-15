import { API_ORIGIN, PROTECTED_HOSTS } from '../config';
import { isApprovedTransportDestination as isApprovedTransportDestinationForOrigin } from './mtlsDestinationPolicy';

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isLocalOrInsecureUrl(url: string): boolean {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return false;
  }

  const host = parsedUrl.hostname.toLowerCase();
  return (
    parsedUrl.protocol === 'http:' || host === 'localhost' || host === '127.0.0.1' || host === '::1'
  );
}

export function isProtectedHost(url: string, expectedProtocol: 'https:' | 'wss:'): boolean {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return false;
  }

  return parsedUrl.protocol === expectedProtocol && PROTECTED_HOSTS.includes(parsedUrl.host);
}

export function isProtectedHttpsHost(url: string): boolean {
  return isProtectedHost(url, 'https:');
}

export function isProtectedSecureWebSocketHost(url: string): boolean {
  return isProtectedHost(url, 'wss:');
}

/**
 * Hosts that may receive app credentials (Authorization, cookies, mTLS): the exact API origin
 * (scheme, host and port) plus loopback for local development; rejects arbitrary destinations.
 */
export function isApprovedTransportDestination(
  url: string,
  expectedApiOrigin: string = API_ORIGIN,
): boolean {
  return isApprovedTransportDestinationForOrigin(url, expectedApiOrigin);
}
