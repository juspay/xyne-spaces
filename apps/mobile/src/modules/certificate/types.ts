/**
 * Certificate module type definitions
 */

export interface DeviceInfo {
  device_name: string;
  platform: 'MOBILE' | 'WEB' | 'DESKTOP';
  os_type: string;
  os_version: string;
  device_fingerprint: string;
}

export interface CSRResult {
  csr: string;
  deviceInfo: DeviceInfo;
}

export interface CertificateInfo {
  subject: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  signatureAlgorithm?: string;
}

export interface KeystoreInfo {
  totalAliases: number;
  hasPrivateKey: boolean;
  hasClientCertificate: boolean;
  hasCACertificate: boolean;
  aliases: string[];
  clientCertificateInfo?: CertificateInfo;
  caCertificateInfo?: CertificateInfo;
}

export interface EnrollmentResponse {
  certificate: string;
  caCertificate: string;
  validUntil: string;
  serialNumber?: string;
}
