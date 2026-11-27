import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EnrollmentFlowError,
  buildCsrQrData,
  parseCertificateQrPayload,
} from '../../../src/services/EnrollmentAPIService';

const certificatePem = [
  '-----BEGIN CERTIFICATE-----',
  'certificate',
  '-----END CERTIFICATE-----',
].join('\n');

const device = {
  device_name: 'Test device',
  platform: 'MOBILE' as const,
  os_type: 'test-os',
  os_version: '1.0',
  device_fingerprint: 'test-fingerprint',
};

function assertRejected(rawData: string, reason: string): void {
  assert.throws(
    () => parseCertificateQrPayload(rawData),
    (error: unknown) => error instanceof EnrollmentFlowError && error.reason === reason,
  );
}

test('builds the CSR QR the enrollment page scans', () => {
  assert.deepEqual(JSON.parse(buildCsrQrData({ csr: 'csr-pem', deviceInfo: device })), {
    csr_pem: 'csr-pem',
    device,
  });
});

test('reads the signed certificate QR', () => {
  assert.deepEqual(parseCertificateQrPayload(JSON.stringify({ pem: `${certificatePem}\n` })), {
    certificate: certificatePem,
    caChain: null,
  });
});

test('reads a certificate QR with a CA chain', () => {
  const caChainPem = certificatePem.replace('certificate', 'ca');
  assert.deepEqual(
    parseCertificateQrPayload(
      JSON.stringify({ certificate: certificatePem, ca_chain: caChainPem }),
    ),
    { certificate: certificatePem, caChain: caChainPem },
  );
});

test('ignores a CA chain that is not a certificate', () => {
  assert.equal(
    parseCertificateQrPayload(JSON.stringify({ pem: certificatePem, ca_chain: 'not-a-chain' }))
      .caChain,
    null,
  );
});

test('rejects a single-QR enrollment token as an unsupported flow', () => {
  assertRejected(
    JSON.stringify({ url: 'https://auth.example.org/api/enrollment/claim', token: 'token' }),
    'unsupported_flow',
  );
});

test('rejects a QR that is not a certificate', () => {
  assertRejected('not json', 'invalid_qr');
  assertRejected('"just a string"', 'invalid_qr');
  assertRejected(JSON.stringify({ pem: 'not a certificate' }), 'invalid_qr');
  assertRejected(JSON.stringify({ pem: 42 }), 'invalid_qr');
  assertRejected(JSON.stringify({ url: 'https://auth.example.org/claim' }), 'invalid_qr');
  assertRejected(JSON.stringify({}), 'invalid_qr');
});
