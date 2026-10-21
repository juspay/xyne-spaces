import { isMtlsFeatureEnabled } from '../config';
import { UnifiedCertificateService } from '../modules/certificate';
import { MtlsHealthResult, verifyMtlsHealthWithRetry } from './MtlsApiService';

export interface EnrollmentStatusResult {
  isEnrolled: boolean;
  isHealthy: boolean;
  health?: MtlsHealthResult;
}

/**
 * Full enrollment + health check (used for re-enrollment flows).
 */
export async function checkEnrollmentAndHealthStatus(): Promise<EnrollmentStatusResult> {
  if (!isMtlsFeatureEnabled()) {
    return {
      isEnrolled: true,
      isHealthy: true,
      health: { isHealthy: true, reason: 'MTLS_DISABLED' },
    };
  }

  const isEnrolled = await UnifiedCertificateService.isEnrolled();
  if (!isEnrolled) {
    return { isEnrolled: false, isHealthy: false };
  }

  const health = await verifyMtlsHealthWithRetry();
  return {
    isEnrolled: true,
    isHealthy: health.isHealthy,
    health,
  };
}

/**
 * Fast local-only enrollment check (no network). Used for startup.
 */
export async function checkEnrollmentLocal(): Promise<boolean> {
  if (!isMtlsFeatureEnabled()) {
    return true;
  }

  return UnifiedCertificateService.isEnrolled();
}

/**
 * Background health verification with single attempt (no retries).
 * Used after the app has already rendered to validate the certificate
 * without blocking the UI.
 */
export async function verifyHealthInBackground(): Promise<MtlsHealthResult> {
  if (!isMtlsFeatureEnabled()) {
    return { isHealthy: true, reason: 'MTLS_DISABLED' };
  }

  return verifyMtlsHealthWithRetry(1, 500);
}
