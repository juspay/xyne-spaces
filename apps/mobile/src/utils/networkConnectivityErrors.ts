import type { MtlsHealthResult } from '@/src/services/MtlsApiService';

const OFFLINE_OR_TRANSIENT = new RegExp(
  [
    'network request failed',
    'the internet connection appears to be offline',
    'network is unreachable',
    'connection refused',
    'connection reset',
    'connection timed out',
    'timeout',
    'timed out',
    'econnrefused',
    'econnreset',
    'enotfound',
    'ehostunreach',
    'enetunreach',
    'eai_again',
    'failed to connect',
    'could not connect',
    'name or service not known',
    'name resolution',
    // Android (OkHttp / java.net): DNS offline — common in logs as MtlsNetworkClient "Network error: Unable to resolve host"
    'unable to resolve host',
    'no address associated with hostname',
    'unknownhost',
    'nsurlerrordomain',
    'kcfurlerror',
    'mtls request failed before receiving',
  ].join('|'),
  'i',
);

/**
 * Heuristic: transport/DNS/timeout (including common RN offline errors), not 401/invalid session.
 */
export function isLikelyOfflineOrTransientNetworkError(message: string | undefined): boolean {
  if (!message?.trim()) {
    return false;
  }
  const lower = message.toLowerCase();
  if (
    /certificate|client cert|client_auth|ssl peer|handshake fail/.test(lower) &&
    !/network request failed/.test(lower)
  ) {
    return false;
  }
  return OFFLINE_OR_TRANSIENT.test(message);
}

/**
 * When mTLS health fails, we still keep the local device enrolled + session if the failure
 * looks like connectivity rather than a bad or missing client certificate.
 */
export function shouldKeepSessionDespiteMtlsHealthFailure(
  health: MtlsHealthResult | undefined,
): boolean {
  if (!health || health.isHealthy) {
    return false;
  }
  if (health.isCertificateError) {
    return false;
  }
  if (health.reason === 'NATIVE_CLIENT_UNAVAILABLE') {
    return false;
  }
  if (health.statusCode === 0) {
    return true;
  }
  if (health.statusCode === 408) {
    return true;
  }
  if (
    health.reason === 'REQUEST_FAILED' &&
    isLikelyOfflineOrTransientNetworkError(health.errorMessage)
  ) {
    return true;
  }
  return isLikelyOfflineOrTransientNetworkError(health.errorMessage);
}

export function isLikelyNetworkErrorFromUnknown(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return isLikelyOfflineOrTransientNetworkError(message);
}
