/**
 * EnrollmentScreen - QR-based certificate enrollment
 *
 * This build uses the single-QR enrollment flow:
 * 1. Scan the enrollment payload displayed on the laptop
 * 2. Generate the keypair + CSR on-device and submit it with the QR token
 * 3. Store the returned certificate and CA chain in the TEE
 */

import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { UnifiedCertificateService, type CSRResult } from '../modules/certificate';
import { checkEnrollmentAndHealthStatus } from '../services/EnrollmentStatusService';
import {
  EnrollmentFlowError,
  submitCSRWithToken,
  validateEnrollmentQrPayload,
} from '../services/EnrollmentAPIService';
import {
  flushSingleQrEnrollmentLogs,
  logSingleQrEnrollment,
  type SingleQrEnrollmentStage,
} from '../services/enrollmentTelemetry';
import { useEnrollment } from '../contexts/EnrollmentContext';
import { useReportStartupReady } from '../observability/logging/hooks/startup/useReportStartupReady';
import QRScanner from './QRScanner';
import EnrollmentStatus from './EnrollmentStatus';

type EnrollmentStep =
  'checking' | 'start' | 'scan_enrollment_qr' | 'submitting' | 'success' | 'error';

const FAILURE_REASON_BY_STAGE: Record<SingleQrEnrollmentStage, string> = {
  screen_check: 'status_check_failed',
  enrollment: 'enrollment_failed',
  qr_validation: 'invalid_qr',
  csr_generation: 'csr_generation_failed',
  csr_submission: 'request_failed',
  certificate_storage: 'certificate_storage_failed',
  mtls_health: 'health_check_failed',
};

interface EnrollmentScreenProps {
  onEnrollmentComplete: () => void;
}

export default function EnrollmentScreen({ onEnrollmentComplete }: EnrollmentScreenProps) {
  const [step, setStep] = useState<EnrollmentStep>('checking');
  const [error, setError] = useState<string>('');
  const isProcessingScanRef = useRef(false);
  const singleQrCsrRef = useRef<CSRResult | null>(null);
  const isMountedRef = useRef(true);
  useReportStartupReady('enrollment', step !== 'checking');

  const { setIsEnrolled } = useEnrollment();

  const background = useCSSVariable('--color-enrollment-background') as string;
  const primaryText = useCSSVariable('--color-enrollment-primary-text') as string;
  const secondaryText = useCSSVariable('--color-enrollment-secondary-text') as string;
  const accent = useCSSVariable('--color-enrollment-accent') as string;
  const stepText = useCSSVariable('--color-enrollment-secondary-text') as string;
  const buttonBg = useCSSVariable('--color-enrollment-button-bg') as string;
  const buttonText = useCSSVariable('--color-enrollment-button-text') as string;

  useEffect(() => {
    checkEnrollmentStatus();
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkEnrollmentStatus() {
    const startedAt = Date.now();

    try {
      const status = await checkEnrollmentAndHealthStatus();

      logSingleQrEnrollment('info', {
        stage: 'screen_check',
        outcome: 'succeeded',
        duration_ms: Date.now() - startedAt,
        is_enrolled: status.isEnrolled,
        is_healthy: status.isHealthy,
      });

      if (!isMountedRef.current) return;

      if (status.isEnrolled && status.isHealthy) {
        setIsEnrolled(true);
        onEnrollmentComplete();
        return;
      }

      setStep('start');
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const errorMessage = err instanceof Error ? err.message : 'Failed to check enrollment status';
      logSingleQrEnrollment('error', {
        stage: 'screen_check',
        outcome: 'failed',
        reason: 'status_check_failed',
        duration_ms: Date.now() - startedAt,
      });
      flushSingleQrEnrollmentLogs();
      console.error('[EnrollmentScreen] Enrollment status check failed:', errorMessage);
      setError(errorMessage);
      setStep('error');
    }
  }

  function handleStartEnrollment() {
    setError('');
    isProcessingScanRef.current = false;
    singleQrCsrRef.current = null;
    logSingleQrEnrollment('info', { stage: 'enrollment', outcome: 'started' });
    setStep('scan_enrollment_qr');
  }

  async function handleEnrollmentQrScanned(data: string) {
    if (isProcessingScanRef.current) {
      return;
    }

    isProcessingScanRef.current = true;
    setStep('submitting');
    setError('');

    let currentStage: SingleQrEnrollmentStage = 'qr_validation';
    const startedAt = Date.now();

    try {
      const enrollment = validateEnrollmentQrPayload(data);

      currentStage = 'csr_generation';
      const csr = singleQrCsrRef.current ?? (await UnifiedCertificateService.generateCSR());
      singleQrCsrRef.current = csr;

      currentStage = 'csr_submission';
      const response = await submitCSRWithToken(
        enrollment.url,
        enrollment.token,
        csr.csr,
        csr.deviceInfo,
      );

      currentStage = 'certificate_storage';
      const stored = await UnifiedCertificateService.storeCertificate(
        response.certificate,
        response.ca_chain || null,
      );
      if (!stored) {
        throw new Error('Certificate storage failed. Please try enrollment again.');
      }

      currentStage = 'mtls_health';
      const status = await checkEnrollmentAndHealthStatus();
      if (!isMountedRef.current) return;

      if (!status.isHealthy) {
        throw new Error(
          'Certificate stored but verification failed. Please check your internet connection or try again.',
        );
      }

      singleQrCsrRef.current = null;
      logSingleQrEnrollment('info', {
        stage: 'enrollment',
        outcome: 'succeeded',
        duration_ms: Date.now() - startedAt,
        is_enrolled: status.isEnrolled,
        is_healthy: status.isHealthy,
        ca_chain_present: Boolean(response.ca_chain),
      });
      flushSingleQrEnrollmentLogs();
      setStep('success');
      setIsEnrolled(true);

      setTimeout(() => {
        onEnrollmentComplete();
      }, 2000);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to complete enrollment';
      const flowError = err instanceof EnrollmentFlowError ? err : null;
      logSingleQrEnrollment('error', {
        stage: currentStage,
        outcome: 'failed',
        reason: flowError?.reason ?? FAILURE_REASON_BY_STAGE[currentStage],
        ...(flowError?.status !== undefined && { status_code: flowError.status }),
        ...(flowError?.code !== undefined && { error_code: flowError.code }),
        duration_ms: Date.now() - startedAt,
      });
      flushSingleQrEnrollmentLogs();
      setError(errorMessage);
      console.error('[EnrollmentScreen] Single-QR enrollment failed:', {
        stage: currentStage,
        reason: flowError?.reason ?? FAILURE_REASON_BY_STAGE[currentStage],
      });
      Alert.alert('Enrollment failed', errorMessage);
      setStep('scan_enrollment_qr');
      isProcessingScanRef.current = false;
    }
  }

  function handleRetry() {
    setError('');
    isProcessingScanRef.current = false;
    singleQrCsrRef.current = null;
    setStep('start');
  }

  if (step === 'checking') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <ActivityIndicator size='large' color={accent} />
          <Text style={{ fontSize: 18, color: primaryText, marginTop: 20, fontWeight: '500' }}>
            Checking enrollment status...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'start') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ marginBottom: 40, alignItems: 'center' }}>
            <Text
              style={{
                fontSize: 28,
                fontWeight: 'bold',
                color: primaryText,
                marginBottom: 10,
                textAlign: 'center',
              }}
            >
              Device Enrollment
            </Text>
            <Text
              style={{
                fontSize: 16,
                color: secondaryText,
                textAlign: 'center',
                lineHeight: 24,
              }}
            >
              Set up your device in 3 easy steps
            </Text>
          </View>

          <View style={{ width: '100%', marginBottom: 32 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 20,
                paddingHorizontal: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: 'bold',
                  color: accent,
                  marginRight: 15,
                  width: 35,
                }}
              >
                1
              </Text>
              <Text style={{ flex: 1, fontSize: 16, color: stepText, lineHeight: 24 }}>
                On your VPN-connected laptop, open https://auth.spaces.xyne.juspay.net in a browser
                and sign in with your work account
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 20,
                paddingHorizontal: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: 'bold',
                  color: accent,
                  marginRight: 15,
                  width: 35,
                }}
              >
                2
              </Text>
              <Text style={{ flex: 1, fontSize: 16, color: stepText, lineHeight: 24 }}>
                On the page that opens after login, tap the &quot;Enroll Mobile&quot; button to
                display the enrollment QR code
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 20,
                paddingHorizontal: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: 'bold',
                  color: accent,
                  marginRight: 15,
                  width: 35,
                }}
              >
                3
              </Text>
              <Text style={{ flex: 1, fontSize: 16, color: stepText, lineHeight: 24 }}>
                Tap &quot;Start Enrollment&quot; below, then point this phone&apos;s camera at the
                QR code shown on your laptop
              </Text>
            </View>
          </View>

          <Text
            style={{
              fontSize: 13,
              color: secondaryText,
              textAlign: 'center',
              lineHeight: 20,
              marginBottom: 32,
              paddingHorizontal: 20,
            }}
          >
            Your device securely generates a key and requests its certificate — no passwords are
            stored on this phone.
          </Text>

          <TouchableOpacity
            style={{
              backgroundColor: buttonBg,
              paddingHorizontal: 40,
              paddingVertical: 16,
              borderRadius: 12,
              minWidth: 200,
            }}
            onPress={handleStartEnrollment}
          >
            <Text
              style={{
                color: buttonText,
                fontSize: 18,
                fontWeight: '600',
                textAlign: 'center',
              }}
            >
              Start Enrollment
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'scan_enrollment_qr') {
    return (
      <QRScanner
        title='Scan Enrollment QR'
        instruction='Scan the enrollment QR code displayed on your laptop'
        onQRScanned={handleEnrollmentQrScanned}
        onCancel={() => {
          isProcessingScanRef.current = false;
          singleQrCsrRef.current = null;
          logSingleQrEnrollment('info', { stage: 'enrollment', outcome: 'cancelled' });
          flushSingleQrEnrollmentLogs();
          setStep('start');
        }}
      />
    );
  }

  if (step === 'submitting') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <ActivityIndicator size='large' color={accent} />
          <Text style={{ fontSize: 18, color: primaryText, marginTop: 20, fontWeight: '500' }}>
            Provisioning your certificate...
          </Text>
          <Text style={{ fontSize: 14, color: secondaryText, marginTop: 8 }}>
            Generating the CSR and securing your device credentials
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'success') {
    return <EnrollmentStatus success={true} />;
  }

  if (step === 'error') {
    return <EnrollmentStatus success={false} error={error} onRetry={handleRetry} />;
  }

  return null;
}
