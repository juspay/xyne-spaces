import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { skipsDeviceEnrollmentGate } from '@/src/config';
import { useEnrollment } from '@/src/contexts/EnrollmentContext';
import {
  evaluateCachedMtlsExpiryWarning,
  resolveCertNotAfter,
  setExpiryWarnedFor,
} from '@/src/services/mtlsCertExpiryStore';

export type MtlsExpiryWarningContent = {
  title: string;
  message: string;
  /** Short how-to for re-enrolling (shown with distinct highlight in the sheet). */
  reEnrollGuide: string;
  notAfterIso: string;
};

export type UseMtlsExpiryWarningResult = {
  visible: boolean;
  content: MtlsExpiryWarningContent | null;
  dismiss: () => void;
};

function buildWarningContent(notAfterIso: string, daysLeft: number): MtlsExpiryWarningContent {
  const expiresOn = new Date(notAfterIso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const dayLabel = daysLeft === 1 ? '1 day' : `${daysLeft} days`;

  return {
    title: 'Certificate expiring soon',
    message: `Your device certificate expires in ${dayLabel} (${expiresOn}).`,
    reEnrollGuide: 'To re-enroll: scan the enrollment QR from Xyne Spaces on your laptop.',
    notAfterIso,
  };
}

/**
 * Soft-warn once per certificate when mTLS client cert expires within 2 days.
 * Local date math only (MMKV / PEM / native) — no health-check network call.
 *
 * Returns sheet state; UI is rendered by `MtlsExpiryWarningGate` (same pattern as
 * the Airborne / app-update bottom sheet).
 */
export function useMtlsExpiryWarning(enabled: boolean = true): UseMtlsExpiryWarningResult {
  const { isEnrolled } = useEnrollment();
  const [content, setContent] = useState<MtlsExpiryWarningContent | null>(null);
  const [visible, setVisible] = useState(false);
  const checkingRef = useRef(false);
  const shownForRef = useRef<string | null>(null);

  const dismiss = useCallback((): void => {
    if (content?.notAfterIso) {
      setExpiryWarnedFor(content.notAfterIso);
      shownForRef.current = content.notAfterIso;
    }
    setVisible(false);
  }, [content?.notAfterIso]);

  const checkExpiry = useCallback(async (): Promise<void> => {
    if (!enabled || skipsDeviceEnrollmentGate() || isEnrolled !== true) return;
    if (checkingRef.current || visible) return;

    checkingRef.current = true;
    try {
      const notAfter = await resolveCertNotAfter();
      if (!notAfter) return;

      const state = evaluateCachedMtlsExpiryWarning(notAfter);
      if (state.kind !== 'warn' || state.alreadyWarned) return;
      if (shownForRef.current === state.notAfterIso) return;

      setContent(buildWarningContent(state.notAfterIso, state.daysLeft));
      setVisible(true);
    } catch (error) {
      console.warn('[useMtlsExpiryWarning] Check failed:', error);
    } finally {
      checkingRef.current = false;
    }
  }, [enabled, isEnrolled, visible]);

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

  return { visible, content, dismiss };
}
