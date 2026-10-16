/**
 * Unified Certificate Service
 * Certificate management for iOS and Android mobile platforms
 */

import { Platform } from 'react-native';
import { invalidateNativeMtlsSession } from '../../services/http/native-request-registry';
import NativeCertificateModule from './NativeCertificateModule';
import { CSRResult, DeviceInfo, EnrollmentResponse } from './types';

/**
 * The native modules already tear their session down whenever the client identity
 * changes. This is the cross-platform safety net for the paths that do not reach
 * that code — a mock or fallback module, or a build where the native call is a
 * no-op — and it must never turn a successful enrollment or logout into a failure.
 */
const invalidateMtlsSessionSafely = async (): Promise<void> => {
  try {
    await invalidateNativeMtlsSession();
  } catch (error) {
    console.warn('[UnifiedCertificateService] Failed to invalidate mTLS session:', error);
  }
};

export const getPlatform = (): 'ios' | 'android' | 'unknown' => {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'unknown';
};

export class UnifiedCertificateService {
  static async isEnrolled(): Promise<boolean> {
    try {
      return await NativeCertificateModule.isEnrolled();
    } catch (error) {
      console.error('[UnifiedCertificateService] Error checking enrollment:', error);
      return false;
    }
  }

  static async hasPrivateKey(): Promise<boolean> {
    try {
      return await NativeCertificateModule.hasPrivateKey();
    } catch (error) {
      console.error('[UnifiedCertificateService] Error checking private key:', error);
      return false;
    }
  }

  static async generateCSR(): Promise<CSRResult> {
    try {
      const result = await NativeCertificateModule.generateCSR();
      await invalidateMtlsSessionSafely();
      return result;
    } catch (error) {
      console.error('[UnifiedCertificateService] Failed to generate CSR:', error);
      throw error;
    }
  }

  static async storeCertificate(
    certificatePem: string,
    caChainPem?: string | null,
  ): Promise<boolean> {
    try {
      const stored = await NativeCertificateModule.storeCertificate(certificatePem, caChainPem);
      await invalidateMtlsSessionSafely();
      return stored;
    } catch (error) {
      console.error('[UnifiedCertificateService] Failed to store certificate:', error);
      throw error;
    }
  }

  static async getCertificate(): Promise<string | null> {
    try {
      return await NativeCertificateModule.getCertificate();
    } catch (error) {
      console.error('[UnifiedCertificateService] Failed to get certificate:', error);
      return null;
    }
  }

  static async clearCertificates(): Promise<void> {
    try {
      await NativeCertificateModule.clearCertificates();
      await invalidateMtlsSessionSafely();
    } catch (error) {
      console.error('[UnifiedCertificateService] Failed to clear certificates:', error);
      throw error;
    }
  }

  static async completeEnrollment(response: EnrollmentResponse): Promise<void> {
    await UnifiedCertificateService.storeCertificate(response.certificate, response.caCertificate);
  }

  static async reEnroll(): Promise<CSRResult> {
    await this.clearCertificates();
    return await this.generateCSR();
  }

  static getPlatform(): string {
    return getPlatform();
  }
}

export type { CSRResult, DeviceInfo };
