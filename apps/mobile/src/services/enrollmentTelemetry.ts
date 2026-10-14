import type { EventType } from '@xyne/shared/logger';

import { APP_VARIANT } from '../config';
import { initializeLogger, logger } from '../utils/logger';

// The shared event registry is generated/ignored in this checkout. Keep the
// wire event name stable locally so the committed mobile code emits a
// dedicated Grafana stream without changing generated shared files.
const SINGLE_QR_ENROLLMENT_EVENT = 'lotus_single_qr_enrollment' as EventType;
const BUILD_VARIANT = APP_VARIANT ?? (__DEV__ ? 'dev' : 'prod');

export type SingleQrEnrollmentStage =
  | 'screen_check'
  | 'enrollment'
  | 'qr_validation'
  | 'csr_generation'
  | 'csr_submission'
  | 'certificate_storage'
  | 'mtls_health';

export type SingleQrEnrollmentOutcome = 'started' | 'succeeded' | 'failed' | 'cancelled';

export type SingleQrEnrollmentTelemetry = {
  stage: SingleQrEnrollmentStage;
  outcome: SingleQrEnrollmentOutcome;
  reason?: string;
  status_code?: number;
  error_code?: string;
  duration_ms?: number;
  is_enrolled?: boolean;
  is_healthy?: boolean;
  ca_chain_present?: boolean;
};

/**
 * Emits the single-QR enrollment event through the existing Grafana/VictoriaLogs pipeline.
 * Keep this payload deliberately allowlisted: never add QR data, tokens, headers, CSRs,
 * certificates, private keys, or raw Error/Axios objects here.
 */
export function logSingleQrEnrollment(
  level: 'info' | 'warn' | 'error',
  fields: SingleQrEnrollmentTelemetry,
): void {
  const payload = {
    flow: 'single_qr' as const,
    build_variant: BUILD_VARIANT,
    ...fields,
  };

  if (level === 'error') {
    logger.error(SINGLE_QR_ENROLLMENT_EVENT, payload);
  } else if (level === 'warn') {
    logger.warn(SINGLE_QR_ENROLLMENT_EVENT, payload);
  } else {
    logger.info(SINGLE_QR_ENROLLMENT_EVENT, payload);
  }
}

/**
 * Enrollment happens before the user may have an email/session. Force the
 * pre-auth buffer through the normal logger endpoint at terminal outcomes so
 * failures are visible in Grafana without waiting for sign-in or the 90-second
 * safety timer.
 */
export function flushSingleQrEnrollmentLogs(): void {
  void initializeLogger()
    .then(async () => {
      const delivered = await logger.flushAllLogs();
      if (!delivered) {
        console.warn('[SingleQrEnrollment] Grafana logs queued for retry');
      }
    })
    .catch(() => {
      console.warn('[SingleQrEnrollment] Failed to flush Grafana logs');
    });
}
