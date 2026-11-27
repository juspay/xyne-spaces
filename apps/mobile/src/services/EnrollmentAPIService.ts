import type { CSRResult } from '../modules/certificate';

export type EnrollmentFailureReason = 'invalid_qr' | 'unsupported_flow';

export class EnrollmentFlowError extends Error {
  readonly reason: EnrollmentFailureReason;

  constructor(message: string, reason: EnrollmentFailureReason) {
    super(message);
    this.name = 'EnrollmentFlowError';
    this.reason = reason;
    Object.setPrototypeOf(this, EnrollmentFlowError.prototype);
  }
}

/** The signed certificate the enrollment page shows back after scanning the CSR QR. */
export interface CertificateQrPayload {
  certificate: string;
  caChain: string | null;
}

const INVALID_QR_MESSAGE =
  'Invalid QR code. Please scan the certificate QR code shown on the enrollment page.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCertificatePem(value: unknown): value is string {
  return typeof value === 'string' && value.includes('BEGIN CERTIFICATE');
}

/**
 * The QR the phone shows for the enrollment page to scan. It holds only the CSR and device
 * details; the private key never leaves the keystore.
 */
export function buildCsrQrData(csr: CSRResult): string {
  return JSON.stringify({ csr_pem: csr.csr, device: csr.deviceInfo });
}

/**
 * Parse the certificate QR the enrollment page shows after signing the CSR. It needs no origin
 * check: a certificate is public, and it only works when it matches the key this device
 * generated for the CSR.
 */
export function parseCertificateQrPayload(rawData: string): CertificateQrPayload {
  let data: unknown;

  try {
    data = JSON.parse(rawData);
  } catch {
    throw new EnrollmentFlowError(INVALID_QR_MESSAGE, 'invalid_qr');
  }

  if (!isRecord(data)) {
    throw new EnrollmentFlowError(INVALID_QR_MESSAGE, 'invalid_qr');
  }

  const certificate = data['pem'] ?? data['certificate'];

  if (certificate === undefined && 'url' in data && 'token' in data) {
    // A single-QR enrollment page: this app only supports the two-QR flow.
    throw new EnrollmentFlowError(
      'This enrollment page uses an enrollment flow this app version does not support. Please contact support.',
      'unsupported_flow',
    );
  }

  if (!isCertificatePem(certificate)) {
    throw new EnrollmentFlowError(INVALID_QR_MESSAGE, 'invalid_qr');
  }

  const caChain = data['ca_chain'];
  return {
    certificate: certificate.trim(),
    caChain: isCertificatePem(caChain) ? caChain.trim() : null,
  };
}

export const EnrollmentAPIService = {
  buildCsrQrData,
  parseCertificateQrPayload,
};
