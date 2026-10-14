import axios from 'axios';
import type { DeviceInfo } from '../modules/certificate';

const REQUEST_TIMEOUT = 30_000;

const TRUSTED_ENROLLMENT_ORIGINS = new Set([
  'https://auth.spaces.xyne.juspay.net',
  'https://auth.spaces.sandbox.xyne.juspay.net',
]);

export type EnrollmentFailureReason =
  | 'invalid_qr'
  | 'invalid_url'
  | 'unsupported_origin'
  | 'invalid_token'
  | 'ca_unavailable'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'unknown';

export class EnrollmentFlowError extends Error {
  readonly reason: EnrollmentFailureReason;
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(
    message: string,
    reason: EnrollmentFailureReason,
    options?: { status?: number | undefined; code?: string | undefined },
  ) {
    super(message);
    this.name = 'EnrollmentFlowError';
    this.reason = reason;
    this.status = options?.status;
    this.code = options?.code;
    Object.setPrototypeOf(this, EnrollmentFlowError.prototype);
  }
}

export interface EnrollmentQrPayload {
  url: string;
  token: string;
}

export interface EnrollmentCertificateResponse {
  certificate: string;
  ca_chain: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildRequestUrl(rawUrl: string): string {
  let requestUrl: URL;

  try {
    requestUrl = new URL(rawUrl.trim());
  } catch {
    throw new EnrollmentFlowError(
      'Invalid enrollment QR code: the enrollment URL is malformed.',
      'invalid_url',
    );
  }

  if (requestUrl.protocol !== 'https:') {
    throw new EnrollmentFlowError('Invalid enrollment URL: HTTPS is required.', 'invalid_url');
  }

  if (!TRUSTED_ENROLLMENT_ORIGINS.has(requestUrl.origin)) {
    throw new EnrollmentFlowError(
      'Unsupported enrollment URL. Please scan a QR code from Xyne Spaces.',
      'unsupported_origin',
    );
  }

  return requestUrl.toString();
}

/** Parse and validate the `{ url, token }` payload displayed by the laptop. */
export function validateEnrollmentQrPayload(rawData: string): EnrollmentQrPayload {
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(rawData);
  } catch {
    throw new EnrollmentFlowError(
      'Invalid QR code format. Please scan the enrollment QR code from your laptop.',
      'invalid_qr',
    );
  }

  if (!isRecord(parsedData)) {
    throw new EnrollmentFlowError(
      'Invalid QR code format. Please scan the enrollment QR code from your laptop.',
      'invalid_qr',
    );
  }

  const url = typeof parsedData['url'] === 'string' ? parsedData['url'].trim() : '';
  const token = typeof parsedData['token'] === 'string' ? parsedData['token'].trim() : '';

  if (!url || !token) {
    throw new EnrollmentFlowError(
      'Invalid enrollment QR code. The URL or token is missing.',
      'invalid_qr',
    );
  }

  const resolvedUrl = buildRequestUrl(url);

  return { url: resolvedUrl, token };
}

/**
 * Submit a device CSR using the token from the laptop QR code.
 * The private key is generated and retained by the native keystore; it is never sent here.
 */
export async function submitCSRWithToken(
  url: string,
  token: string,
  csrPem: string,
  deviceInfo: DeviceInfo,
): Promise<EnrollmentCertificateResponse> {
  const requestUrl = buildRequestUrl(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await axios.post<unknown>(
      requestUrl,
      {
        token,
        csr_pem: csrPem,
        device: deviceInfo,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
        timeout: REQUEST_TIMEOUT,
      },
    );

    const responseData: unknown = response.data;
    const certificate = isRecord(responseData) ? responseData['certificate'] : undefined;
    const caChain = isRecord(responseData) ? responseData['ca_chain'] : undefined;

    if (typeof certificate !== 'string' || !certificate.includes('BEGIN CERTIFICATE')) {
      throw new EnrollmentFlowError(
        'Invalid enrollment response: missing certificate data.',
        'invalid_response',
      );
    }

    return {
      certificate,
      ca_chain: typeof caChain === 'string' ? caChain : '',
    };
  } catch (error: unknown) {
    if (error instanceof EnrollmentFlowError) {
      throw error;
    }

    if (
      axios.isAxiosError(error) &&
      (error.code === 'ERR_CANCELED' || error.code === 'ECONNABORTED')
    ) {
      throw new EnrollmentFlowError(
        'Enrollment request timed out. Please check your network connection.',
        'timeout',
        { code: error.code },
      );
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const responseData: unknown = error.response?.data;
      const serverMessage =
        isRecord(responseData) &&
        (typeof responseData['message'] === 'string'
          ? responseData['message']
          : typeof responseData['error'] === 'string'
            ? responseData['error']
            : undefined);
      const errorMessage = serverMessage || (status ? `Enrollment failed: ${status}` : '');

      if (status === 400 || status === 401) {
        throw new EnrollmentFlowError(
          `Invalid enrollment token: ${errorMessage}`,
          'invalid_token',
          {
            status,
            code: error.code,
          },
        );
      }

      if (status === 502) {
        throw new EnrollmentFlowError(
          `Certificate authority unavailable: ${errorMessage}`,
          'ca_unavailable',
          { status, code: error.code },
        );
      }

      if (!status) {
        throw new EnrollmentFlowError(
          'Network error. Please check your internet connection.',
          'network',
          { code: error.code },
        );
      }

      throw new EnrollmentFlowError(
        errorMessage || 'Failed to submit enrollment request.',
        'server_error',
        { status, code: error.code },
      );
    }

    throw error instanceof Error
      ? error
      : new EnrollmentFlowError('Failed to submit enrollment request.', 'unknown');
  } finally {
    clearTimeout(timeoutId);
  }
}

export const EnrollmentAPIService = {
  validateEnrollmentQrPayload,
  submitCSRWithToken,
};
