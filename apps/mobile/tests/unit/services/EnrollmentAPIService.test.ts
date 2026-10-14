import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import {
  submitCSRWithToken,
  validateEnrollmentQrPayload,
} from '../../../src/services/EnrollmentAPIService';

const certificatePem = [
  '-----BEGIN CERTIFICATE-----',
  'certificate',
  '-----END CERTIFICATE-----',
].join('\n');

test('validates the laptop enrollment QR payload', () => {
  assert.deepEqual(
    validateEnrollmentQrPayload(
      JSON.stringify({
        url: 'https://auth.spaces.xyne.juspay.net/api/enrollment/claim',
        token: 'enrollment-token',
      }),
    ),
    {
      url: 'https://auth.spaces.xyne.juspay.net/api/enrollment/claim',
      token: 'enrollment-token',
    },
  );
});

test('rejects an enrollment URL without an absolute origin', () => {
  assert.throws(
    () =>
      validateEnrollmentQrPayload(
        JSON.stringify({ url: '/api/enrollment/claim', token: 'enrollment-token' }),
      ),
    /enrollment URL is malformed/,
  );
});

test('rejects an enrollment QR from an untrusted origin', () => {
  assert.throws(
    () =>
      validateEnrollmentQrPayload(
        JSON.stringify({ url: 'https://example.com/enrollment', token: 'token' }),
      ),
    /Unsupported enrollment URL/,
  );
});

test('rejects a non-HTTPS enrollment URL', () => {
  assert.throws(
    () =>
      validateEnrollmentQrPayload(
        JSON.stringify({ url: 'http://127.0.0.1:3443/api/enrollment/claim', token: 'token' }),
      ),
    /HTTPS is required/,
  );
});

test('submits the CSR and token using the single-QR contract', async () => {
  const originalPost = axios.post;
  let request:
    | {
        url: string;
        data: unknown;
        config: unknown;
      }
    | undefined;

  axios.post = (async (url, data, config) => {
    request = { url: String(url), data, config };
    return {
      status: 200,
      data: { certificate: certificatePem, ca_chain: 'ca-chain' },
    } as never;
  }) as typeof axios.post;

  try {
    const response = await submitCSRWithToken(
      'https://auth.spaces.xyne.juspay.net/api/enrollment/claim',
      'enrollment-token',
      'csr-pem',
      {
        device_name: 'Test device',
        platform: 'MOBILE',
        os_type: 'test-os',
        os_version: '1.0',
        device_fingerprint: 'test-fingerprint',
      },
    );

    assert.deepEqual(response, { certificate: certificatePem, ca_chain: 'ca-chain' });
    assert.equal(request?.url, 'https://auth.spaces.xyne.juspay.net/api/enrollment/claim');
    assert.equal(
      request?.config &&
        (request.config as { headers?: Record<string, string> }).headers?.['Authorization'],
      'Bearer enrollment-token',
    );
    assert.deepEqual(request?.data, {
      token: 'enrollment-token',
      csr_pem: 'csr-pem',
      device: {
        device_name: 'Test device',
        platform: 'MOBILE',
        os_type: 'test-os',
        os_version: '1.0',
        device_fingerprint: 'test-fingerprint',
      },
    });
  } finally {
    axios.post = originalPost;
  }
});
