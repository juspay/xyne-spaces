import log from 'electron-log/main';
import {
  isClientAuthFailure,
  isStoredCertificateExpired,
  recoverFromDeadCertificate,
} from './mtls-recovery';
import { EnrollmentReason, type EnrollmentReasonType } from './enrollment-reason';

/**
 * Check if an error string indicates the server rejected our client certificate.
 *
 * Only client-auth failures count. A server-trust error (untrusted CA, hostname mismatch) is not
 * the device certificate's fault, and deleting the device identity over one would cost the user
 * an enrollment for nothing.
 */
export function isCertificateError(errorDescription: string): boolean {
  return isClientAuthFailure(errorDescription);
}

/**
 * Handle certificate error by clearing the dead certificate and sending the user to enrollment.
 *
 * The user-visible reason is derived from the locally stored notAfter: past it, this is an
 * expiry; otherwise the backend rejected a certificate that should still have been valid
 * (revoked, or re-issued elsewhere).
 */
export async function handleCertificateError(
  errorDetails: {
    url?: string;
    errorCode?: string;
    errorDescription?: string;
  }
): Promise<void> {
  log.error('[CertificateErrorHandler] Certificate error detected:', {
    url: errorDetails.url,
    errorCode: errorDetails.errorCode,
    errorDescription: errorDetails.errorDescription,
  });

  const reason: EnrollmentReasonType = isStoredCertificateExpired()
    ? EnrollmentReason.CERTIFICATE_EXPIRED
    : EnrollmentReason.CERTIFICATE_REJECTED;

  await recoverFromDeadCertificate(reason, {
    detail: errorDetails.errorCode ?? errorDetails.errorDescription,
    trigger: 'certificate_error_handler',
  });
}
