import { type ReactElement } from 'react';

import { skipsDeviceEnrollmentGate } from '@/src/config';
import { useEnrollment } from '@/src/contexts/EnrollmentContext';
import { useMtlsExpiryWarning } from '@/src/hooks/useMtlsExpiryWarning';

import { MtlsExpiryWarningBottomSheet } from './MtlsExpiryWarningBottomSheet';

/**
 * Mounts the mTLS expiry bottom sheet when the device cert is within 2 days of
 * expiring. Same gate pattern as `UpdatePromptGate` (Airborne / app update).
 */
export function MtlsExpiryWarningGate(): ReactElement | null {
  const { isEnrolled, isEnrollmentLoading } = useEnrollment();
  const enabled =
    !skipsDeviceEnrollmentGate() && isEnrolled === true && !isEnrollmentLoading;
  const { visible, daysLeft, notAfterIso, dismiss } = useMtlsExpiryWarning(enabled);

  if (daysLeft == null || notAfterIso == null) return null;

  return (
    <MtlsExpiryWarningBottomSheet
      open={visible}
      daysLeft={daysLeft}
      notAfterIso={notAfterIso}
      onDismiss={dismiss}
    />
  );
}
