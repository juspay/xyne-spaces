import { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';

import { skipsDeviceEnrollmentGate } from '@/src/config';
import { useEnrollment } from '@/src/contexts/EnrollmentContext';
import {
  evaluateCachedMtlsExpiryWarning,
  resolveCertNotAfter,
  setExpiryWarnedFor,
} from '@/src/services/mtlsCertExpiryStore';

/**
 * Soft-warn once per certificate when mTLS client cert expires within 2 days.
 * Local date math only (MMKV / PEM / native) — no health-check network call.
 *
 * Not Now → dismiss, keep session (once per cert).
 */
export function useMtlsExpiryWarning(enabled: boolean = true): void {
  const { isEnrolled } = useEnrollment();
  const alertVisibleRef = useRef(false);
  const checkingRef = useRef(false);

  const showWarning = useCallback((notAfterIso: string, daysLeft: number): void => {
    if (alertVisibleRef.current) return;
    alertVisibleRef.current = true;

    const expiresOn = new Date(notAfterIso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const dayLabel = daysLeft === 1 ? '1 day' : `${daysLeft} days`;

    const dismiss = (): void => {
      setExpiryWarnedFor(notAfterIso);
      alertVisibleRef.current = false;
    };

    Alert.alert(
      'Certificate expiring soon',
      `Your device certificate expires in ${dayLabel} (${expiresOn}). Re-enroll now to avoid being signed out.`,
      [
        {
          text: 'Not Now',
          style: 'cancel',
          onPress: dismiss,
        },
      ],
      {
        cancelable: true,
        onDismiss: dismiss,
      },
    );
  }, []);

  const checkExpiry = useCallback(async (): Promise<void> => {
    if (!enabled || skipsDeviceEnrollmentGate() || isEnrolled !== true) return;
    if (checkingRef.current || alertVisibleRef.current) return;

    checkingRef.current = true;
    try {
      const notAfter = await resolveCertNotAfter();
      if (!notAfter) return;

      const state = evaluateCachedMtlsExpiryWarning(notAfter);
      if (state.kind !== 'warn' || state.alreadyWarned) return;

      showWarning(state.notAfterIso, state.daysLeft);
    } catch (error) {
      console.warn('[useMtlsExpiryWarning] Check failed:', error);
    } finally {
      checkingRef.current = false;
    }
  }, [enabled, isEnrolled, showWarning]);

  useEffect(() => {
    void checkExpiry();
  }, [checkExpiry]);

  useEffect(() => {
    if (!enabled || skipsDeviceEnrollmentGate() || isEnrolled !== true) return;

    const onAppStateChange = (state: AppStateStatus): void => {
      if (state === 'active') {
        void checkExpiry();
      }
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);
    return (): void => subscription.remove();
  }, [enabled, isEnrolled, checkExpiry]);
}
