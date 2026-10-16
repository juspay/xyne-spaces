import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import NativeCertificateModule from '@/src/modules/certificate/NativeCertificateModule';
import { getString, setString } from '@/src/services/localStorage';
import { evaluateMtlsExpiryWarning } from '@/src/services/mtlsCertExpiryPolicy';
import { parseMtlsCertExpiryFromPem } from '@/src/utils/parseMtlsCertExpiry';

/** Persists which cert `notAfter` the user already dismissed the soft warning for. */
const MTLS_CERT_EXPIRY_WARNED_FOR_KEY = '@lotus_mtls_cert_expiry_warned_for';

export type UseMtlsExpiryWarningResult = {
  visible: boolean;
  /** Present once a warning has been evaluated; sheet owns title / guide copy. */
  daysLeft: number | null;
  notAfterIso: string | null;
  dismiss: () => void;
};

async function resolveCertNotAfterFromPem(): Promise<string | null> {
  try {
    const pem = await NativeCertificateModule.getCertificate();
    if (!pem) return null;
    return parseMtlsCertExpiryFromPem(pem);
  } catch {
    return null;
  }
}

/**
 * Soft-warn once per certificate when mTLS client cert expires within 2 days.
 * Reads `notAfter` from the stored PEM via `getCertificate` — no network call.
 *
 * Enablement (enrollment / skip gate) is owned by the caller. Sheet copy lives in
 * `MtlsExpiryWarningBottomSheet`.
 */
export function useMtlsExpiryWarning(enabled: boolean = true): UseMtlsExpiryWarningResult {
  const [visible, setVisible] = useState(false);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [notAfterIso, setNotAfterIso] = useState<string | null>(null);
  const visibleRef = useRef(false);
  const checkingRef = useRef(false);
  const notAfterRef = useRef<string | null>(null);

  const dismiss = useCallback((): void => {
    if (notAfterRef.current) {
      setString(MTLS_CERT_EXPIRY_WARNED_FOR_KEY, notAfterRef.current);
    }
    visibleRef.current = false;
    setVisible(false);
  }, []);

  const checkExpiry = useCallback(async (): Promise<void> => {
    if (!enabled || checkingRef.current || visibleRef.current) return;

    checkingRef.current = true;
    try {
      const notAfter = await resolveCertNotAfterFromPem();
      if (!notAfter) return;
      if (getString(MTLS_CERT_EXPIRY_WARNED_FOR_KEY) === notAfter) return;

      const state = evaluateMtlsExpiryWarning(notAfter, Date.now());
      if (state.kind !== 'warn') return;
      if (visibleRef.current) return;

      notAfterRef.current = state.notAfterIso;
      setNotAfterIso(state.notAfterIso);
      setDaysLeft(state.daysLeft);
      visibleRef.current = true;
      setVisible(true);
    } catch (error) {
      console.warn('[useMtlsExpiryWarning] Check failed:', error);
    } finally {
      checkingRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    void checkExpiry();
  }, [checkExpiry]);

  useEffect(() => {
    if (!enabled) return;

    const onAppStateChange = (state: AppStateStatus): void => {
      if (state === 'active') {
        void checkExpiry();
      }
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);
    return (): void => subscription.remove();
  }, [enabled, checkExpiry]);

  return { visible, daysLeft, notAfterIso, dismiss };
}
