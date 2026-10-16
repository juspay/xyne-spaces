/**
 * Native Certificate Module
 * TypeScript interface for native certificate operations
 */

import { NativeModules } from 'react-native';
import { CSRResult } from './types';

export interface CertificateModuleInterface {
  isEnrolled(): Promise<boolean>;
  hasPrivateKey(): Promise<boolean>;
  generateCSR(): Promise<CSRResult>;
  storeCertificate(certificatePem: string, caChainPem?: string | null): Promise<boolean>;
  getCertificate(): Promise<string>;
  clearCertificates(): Promise<boolean>;
}

const CertificateModule = NativeModules['CertificateModule'] as
  CertificateModuleInterface | undefined;
const hasTurboInvoke =
  CertificateModule &&
  typeof CertificateModule === 'object' &&
  typeof CertificateModule?.storeCertificate === 'function' &&
  !Object.prototype.hasOwnProperty.call(CertificateModule.storeCertificate, '__isNativeFunction');

const CertificateModuleProxy: CertificateModuleInterface = {
  isEnrolled: async () => {
    if (!CertificateModule) {
      console.warn('CertificateModule not available - native module not linked');
      return false;
    }
    return CertificateModule.isEnrolled();
  },

  hasPrivateKey: async () => {
    if (!CertificateModule) {
      console.warn('CertificateModule not available - native module not linked');
      return false;
    }
    return CertificateModule.hasPrivateKey();
  },

  generateCSR: async () => {
    if (!CertificateModule) {
      throw new Error(
        'CertificateModule not available. Please ensure native module is properly linked for your platform.',
      );
    }
    return CertificateModule.generateCSR();
  },

  storeCertificate: async (certificatePem: string, caChainPem?: string | null) => {
    if (!CertificateModule) {
      throw new Error(
        'CertificateModule not available. Please ensure native module is properly linked for your platform.',
      );
    }

    if (hasTurboInvoke && typeof certificatePem === 'string') {
      return CertificateModule.storeCertificate(String(certificatePem), caChainPem ?? null);
    }

    return CertificateModule.storeCertificate(certificatePem, caChainPem);
  },

  getCertificate: async () => {
    if (!CertificateModule) {
      throw new Error(
        'CertificateModule not available. Please ensure native module is properly linked for your platform.',
      );
    }
    return CertificateModule.getCertificate();
  },

  clearCertificates: async () => {
    if (!CertificateModule) {
      throw new Error(
        'CertificateModule not available. Please ensure native module is properly linked for your platform.',
      );
    }
    return CertificateModule.clearCertificates();
  },
};

export default CertificateModuleProxy;
