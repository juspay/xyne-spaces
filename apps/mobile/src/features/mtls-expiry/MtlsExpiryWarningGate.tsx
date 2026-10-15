import { type ReactElement } from 'react';

import { useEnrollment } from '@/src/contexts/EnrollmentContext';
import { useMtlsExpiryWarning } from '@/src/hooks/useMtlsExpiryWarning';

import { MtlsExpiryWarningBottomSheet } from './MtlsExpiryWarningBottomSheet';

/**
 * Mounts the mTLS expiry bottom sheet when the device cert is within 2 days of
 * expiring. Same gate pattern as `UpdatePromptGate` (Airborne / app update).
 */
export function MtlsExpiryWarningGate(): ReactElement | null {
  const { isEnrolled, isEnrollmentLoading } = useEnrollment();
  const enabled = isEnrolled === true && !isEnrollmentLoading;
  const { visible, content, dismiss } = useMtlsExpiryWarning(enabled);

  if (!content) return null;

  return (
    <MtlsExpiryWarningBottomSheet
      open={visible}
      title={content.title}
      message={content.message}
      reEnrollGuide={content.reEnrollGuide}
      onDismiss={dismiss}
    />
  );
}
