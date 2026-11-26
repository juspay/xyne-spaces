/**
 * EnrollmentScreen - two-QR certificate enrollment
 *
 * 1. Generate the keypair + CSR on-device and show the CSR as a QR code
 * 2. The enrollment page scans it, signs it and shows the certificate as a QR code
 * 3. Scan that QR and store the certificate (and CA chain, when given) in the TEE
 *
 * The CSR is kept until enrollment ends or is cancelled from the CSR QR screen: a certificate the
 * page already signed only matches the key generated for that CSR.
 */

import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { UnifiedCertificateService, type CSRResult } from '../modules/certificate';
import { checkEnrollmentAndHealthStatus } from '../services/EnrollmentStatusService';
import {
  EnrollmentFlowError,
  buildCsrQrData,
  parseCertificateQrPayload,
} from '../services/EnrollmentAPIService';
import {
  flushQrEnrollmentLogs,
  logQrEnrollment,
  type QrEnrollmentStage,
} from '../services/enrollmentTelemetry';
import { useEnrollment } from '../contexts/EnrollmentContext';
import { ENROLLMENT_PORTAL_URL } from '../config';
import { useReportStartupReady } from '../observability/logging/hooks/startup/useReportStartupReady';
import QRScanner from './QRScanner';
import QRDisplay from './QRDisplay';
import EnrollmentStatus from './EnrollmentStatus';

type EnrollmentStep =
  | 'checking'
  | 'start'
  | 'preparing'
  | 'show_csr_qr'
  | 'scan_cert_qr'
  | 'storing'
  | 'success'
  | 'error';

const FAILURE_REASON_BY_STAGE: Record<QrEnrollmentStage, string> = {
  screen_check: 'status_check_failed',
  enrollment: 'enrollment_failed',
  csr_generation: 'csr_generation_failed',
  qr_validation: 'invalid_qr',
  certificate_storage: 'certificate_storage_failed',
  mtls_health: 'health_check_failed',
};

interface EnrollmentScreenProps {
  onEnrollmentComplete: () => void;
}

export default function EnrollmentScreen({ onEnrollmentComplete }: EnrollmentScreenProps) {
  const [step, setStep] = useState<EnrollmentStep>('checking');
  const [error, setError] = useState<string>('');
  const [csrQrData, setCsrQrData] = useState<string>('');
  const isProcessingScanRef = useRef(false);
  const csrRef = useRef<CSRResult | null>(null);
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

      logQrEnrollment('info', {
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
      logQrEnrollment('error', {
        stage: 'screen_check',
        outcome: 'failed',
        reason: 'status_check_failed',
        duration_ms: Date.now() - startedAt,
      });
      flushQrEnrollmentLogs();
      console.error('[EnrollmentScreen] Enrollment status check failed:', errorMessage);
      setError(errorMessage);
      setStep('error');
    }
  }

  function resetEnrollment() {
    setError('');
    setCsrQrData('');
    isProcessingScanRef.current = false;
    csrRef.current = null;
  }

  async function handleStartEnrollment() {
    resetEnrollment();
    logQrEnrollment('info', { stage: 'enrollment', outcome: 'started' });
    setStep('preparing');

    const startedAt = Date.now();
    try {
      const csr = await UnifiedCertificateService.generateCSR();
      if (!isMountedRef.current) return;

      csrRef.current = csr;
      setCsrQrData(buildCsrQrData(csr));
      setStep('show_csr_qr');
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to prepare enrollment';
      logQrEnrollment('error', {
        stage: 'csr_generation',
        outcome: 'failed',
        reason: FAILURE_REASON_BY_STAGE.csr_generation,
        duration_ms: Date.now() - startedAt,
      });
      flushQrEnrollmentLogs();
      console.error('[EnrollmentScreen] CSR generation failed');
      setError(errorMessage);
      setStep('error');
    }
  }

  function handleCancelEnrollment() {
    resetEnrollment();
    logQrEnrollment('info', { stage: 'enrollment', outcome: 'cancelled' });
    flushQrEnrollmentLogs();
    setStep('start');
  }

  async function handleCertificateQrScanned(data: string) {
    if (isProcessingScanRef.current || !csrRef.current) {
      return;
    }

    isProcessingScanRef.current = true;
    setStep('storing');
    setError('');

    let currentStage: QrEnrollmentStage = 'qr_validation';
    const startedAt = Date.now();

    try {
      const { certificate, caChain } = parseCertificateQrPayload(data);

      currentStage = 'certificate_storage';
      const stored = await UnifiedCertificateService.storeCertificate(certificate, caChain);
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

      csrRef.current = null;
      logQrEnrollment('info', {
        stage: 'enrollment',
        outcome: 'succeeded',
        duration_ms: Date.now() - startedAt,
        is_enrolled: status.isEnrolled,
        is_healthy: status.isHealthy,
        ca_chain_present: Boolean(caChain),
      });
      flushQrEnrollmentLogs();
      setStep('success');
      setIsEnrolled(true);

      setTimeout(() => {
        onEnrollmentComplete();
      }, 2000);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to complete enrollment';
      const reason =
        err instanceof EnrollmentFlowError ? err.reason : FAILURE_REASON_BY_STAGE[currentStage];
      logQrEnrollment('error', {
        stage: currentStage,
        outcome: 'failed',
        reason,
        duration_ms: Date.now() - startedAt,
      });
      flushQrEnrollmentLogs();
      setError(errorMessage);
      console.error('[EnrollmentScreen] QR enrollment failed:', { stage: currentStage, reason });
      Alert.alert('Enrollment failed', errorMessage);
      setStep('scan_cert_qr');
      isProcessingScanRef.current = false;
    }
  }

  function handleRetry() {
    resetEnrollment();
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
                On your VPN-connected laptop, open{' '}
                {ENROLLMENT_PORTAL_URL ?? 'the Xyne Spaces device enrollment portal'} in a browser,
                sign in with your work account and tap the &quot;Enroll Mobile&quot; button
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
                Tap &quot;Start Enrollment&quot; below and hold the QR code this phone shows up to
                your laptop&apos;s webcam
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
                Tap &quot;Continue&quot;, then point this phone&apos;s camera at the certificate QR
                code the page shows to finish enrollment
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

  if (step === 'preparing') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <ActivityIndicator size='large' color={accent} />
          <Text style={{ fontSize: 18, color: primaryText, marginTop: 20, fontWeight: '500' }}>
            Generating your secure QR code...
          </Text>
          <Text style={{ fontSize: 14, color: secondaryText, marginTop: 8 }}>
            Your key is created in this device&apos;s secure hardware
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'show_csr_qr') {
    return (
      <QRDisplay
        title='Show This QR Code'
        instruction='Hold this screen up to the webcam of the laptop showing the enrollment page. Then tap Continue and scan the certificate QR code the page shows.'
        data={csrQrData}
        onContinue={() => {
          isProcessingScanRef.current = false;
          setStep('scan_cert_qr');
        }}
        onCancel={handleCancelEnrollment}
      />
    );
  }

  if (step === 'scan_cert_qr') {
    // Back goes to the CSR QR, not the start: the page may already have signed this CSR.
    return (
      <QRScanner
        title='Scan Signed Certificate'
        instruction='Scan the certificate QR code shown on the enrollment page on your laptop'
        onQRScanned={handleCertificateQrScanned}
        onCancel={() => {
          isProcessingScanRef.current = false;
          setStep('show_csr_qr');
        }}
      />
    );
  }

  if (step === 'storing') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <ActivityIndicator size='large' color={accent} />
          <Text style={{ fontSize: 18, color: primaryText, marginTop: 20, fontWeight: '500' }}>
            Provisioning your certificate...
          </Text>
          <Text style={{ fontSize: 14, color: secondaryText, marginTop: 8 }}>
            Securing your device credentials
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
