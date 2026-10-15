/**
 * Local cache of the device mTLS client cert's `notAfter`.
 * Used for a soft 2-day expiry warning — no network required.
 */

import { deleteKeys, getString, setString } from '@/src/services/localStorage';
import NativeCertificateModule from '@/src/modules/certificate/NativeCertificateModule';
import { parseMtlsCertExpiryFromPem } from '@/src/utils/parseMtlsCertExpiry';
import {
  evaluateMtlsExpiryWarning,
  type MtlsExpiryWarningState,
} from '@/src/services/mtlsCertExpiryPolicy';

export const MTLS_CERT_NOT_AFTER_KEY = '@lotus_mtls_cert_not_after';
export const MTLS_CERT_EXPIRY_WARNED_FOR_KEY = '@lotus_mtls_cert_expiry_warned_for';

export {
  evaluateMtlsExpiryWarning,
  MTLS_EXPIRY_WARN_WINDOW_MS,
  type MtlsExpiryWarningState,
} from '@/src/services/mtlsCertExpiryPolicy';

export function getCachedCertNotAfter(): string | null {
  return getString(MTLS_CERT_NOT_AFTER_KEY);
}

export function getExpiryWarnedFor(): string | null {
  return getString(MTLS_CERT_EXPIRY_WARNED_FOR_KEY);
}

export function setExpiryWarnedFor(notAfterIso: string): void {
  setString(MTLS_CERT_EXPIRY_WARNED_FOR_KEY, notAfterIso);
}

export function cacheCertNotAfter(notAfterIso: string): void {
  setString(MTLS_CERT_NOT_AFTER_KEY, notAfterIso);
}

export function clearMtlsCertExpiryCache(): void {
  deleteKeys([MTLS_CERT_NOT_AFTER_KEY, MTLS_CERT_EXPIRY_WARNED_FOR_KEY]);
}

/** Persist `notAfter` from a PEM just stored during enrollment. */
export function cacheNotAfterFromPem(certificatePem: string): void {
  const notAfter = parseMtlsCertExpiryFromPem(certificatePem);
  if (notAfter) {
    cacheCertNotAfter(notAfter);
    deleteKeys([MTLS_CERT_EXPIRY_WARNED_FOR_KEY]);
  }
}

async function readNotAfterFromNative(): Promise<string | null> {
  try {
    const value = await NativeCertificateModule.getCertificateNotAfter();
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  } catch {
    // Native method missing until next prebuild — fall through to PEM parse.
  }
  return null;
}

/**
 * Resolve cert expiry: MMKV → native → PEM parse. Caches on success.
 */
export async function resolveCertNotAfter(): Promise<string | null> {
  const cached = getCachedCertNotAfter();
  if (cached) {
    const t = Date.parse(cached);
    if (!Number.isNaN(t)) return cached;
  }

  const fromNative = await readNotAfterFromNative();
  if (fromNative) {
    const normalized = new Date(fromNative).toISOString();
    if (!Number.isNaN(Date.parse(normalized))) {
      cacheCertNotAfter(normalized);
      return normalized;
    }
  }

  try {
    const pem = await NativeCertificateModule.getCertificate();
    if (!pem) return null;
    const fromPem = parseMtlsCertExpiryFromPem(pem);
    if (fromPem) {
      cacheCertNotAfter(fromPem);
    }
    return fromPem;
  } catch {
    return null;
  }
}

/** Evaluate warning using cached “already warned” flag from MMKV. */
export function evaluateCachedMtlsExpiryWarning(
  notAfterIso: string,
  nowMs: number = Date.now(),
): MtlsExpiryWarningState {
  return evaluateMtlsExpiryWarning(notAfterIso, nowMs, getExpiryWarnedFor());
}
