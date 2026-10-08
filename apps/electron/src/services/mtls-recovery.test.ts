import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('electron', () => ({
  app: { on: vi.fn(), once: vi.fn(), getVersion: () => '0.0.0-test' },
  powerMonitor: { on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string): unknown {
      return storeData.get(key);
    }
    set(key: string, value: unknown): void {
      storeData.set(key, value);
    }
    delete(key: string): void {
      storeData.delete(key);
    }
  },
}));
vi.mock('./logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), logError: vi.fn() },
}));
vi.mock('../keychain', () => ({ keychain: { deleteIdentity: vi.fn() } }));
vi.mock('../app/config', () => ({
  config: {
    enableMtls: true,
    MTLS_IDENTITY_NAME: 'Test Client',
    MTLS_FRONTEND_URL: 'https://auth.example.test',
  },
}));

import {
  isClientAuthFailure,
  isStoredCertificateExpired,
  getStoredCertificateExpiry,
  recordIssuedCertificate,
} from './mtls-recovery';

const NOT_AFTER_KEY = 'mtls.certificateNotAfter';

describe('isClientAuthFailure', () => {
  it('matches the client-auth TLS errors that mean our certificate was rejected', () => {
    expect(isClientAuthFailure('net::ERR_BAD_SSL_CLIENT_AUTH_CERT')).toBe(true);
    expect(isClientAuthFailure("ERR_SSL_CLIENT_AUTH_SIGNATURE_FAILED (-141) loading 'https://x'")).toBe(
      true,
    );
    expect(isClientAuthFailure('ERR_SSL_CLIENT_AUTH_CERT_NEEDED')).toBe(true);
  });

  it('ignores server-trust and transport errors, which deleting our identity would not fix', () => {
    expect(isClientAuthFailure('net::ERR_CERT_AUTHORITY_INVALID')).toBe(false);
    expect(isClientAuthFailure('net::ERR_CERT_DATE_INVALID')).toBe(false);
    expect(isClientAuthFailure('net::ERR_CONNECTION_REFUSED')).toBe(false);
    expect(isClientAuthFailure('net::ERR_NAME_NOT_RESOLVED')).toBe(false);
    expect(isClientAuthFailure(undefined)).toBe(false);
    expect(isClientAuthFailure('')).toBe(false);
  });
});

describe('stored certificate expiry', () => {
  beforeEach(() => {
    storeData.clear();
  });

  it('treats an unknown expiry as not expired so pre-upgrade devices are left alone', () => {
    expect(getStoredCertificateExpiry()).toBeNull();
    expect(isStoredCertificateExpired()).toBe(false);
  });

  it('ignores an unparseable stored value', () => {
    storeData.set(NOT_AFTER_KEY, 'not-a-date');
    expect(getStoredCertificateExpiry()).toBeNull();
    expect(isStoredCertificateExpired()).toBe(false);
  });

  it('reports expired once past notAfter', () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    storeData.set(NOT_AFTER_KEY, new Date(now - 1000).toISOString());
    expect(isStoredCertificateExpired(now)).toBe(true);
  });

  it('expires slightly early to absorb clock skew against the backend', () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    // 1 minute of validity left — inside the 2 minute skew window.
    storeData.set(NOT_AFTER_KEY, new Date(now + 60_000).toISOString());
    expect(isStoredCertificateExpired(now)).toBe(true);

    // 10 minutes left — comfortably valid.
    storeData.set(NOT_AFTER_KEY, new Date(now + 600_000).toISOString());
    expect(isStoredCertificateExpired(now)).toBe(false);
  });

  it('stores notAfter read from the issued certificate PEM', () => {
    // Self-signed throwaway generated for this test (notAfter 2126-09-14); only the validity
    // window is read.
    const pem = [
      '-----BEGIN CERTIFICATE-----',
      'MIIBgjCCASmgAwIBAgIUS/R6jzrRcedDQLk+5bgz215uP38wCgYIKoZIzj0EAwIw',
      'FjEUMBIGA1UEAwwLVGVzdCBDbGllbnQwIBcNMjYxMDA4MDY1NjUzWhgPMjEyNjA5',
      'MTQwNjU2NTNaMBYxFDASBgNVBAMMC1Rlc3QgQ2xpZW50MFkwEwYHKoZIzj0CAQYI',
      'KoZIzj0DAQcDQgAEQl+a/lFXArQM6L0T8bC1HpcyXze8VdfyPB+wSEbEXgQA5EXv',
      'D+4MGyi6PcujSMNIal7qDagHlTRiDD/dRtPZIqNTMFEwHQYDVR0OBBYEFGyocMrF',
      '1y3olacybziPdj+Rt1qcMB8GA1UdIwQYMBaAFGyocMrF1y3olacybziPdj+Rt1qc',
      'MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgd6AUgS8tgk+iF1a1',
      '+Jbiuf9gDEa9uKPB7M2mE2lfvJ8CIBMhDirasju6X3VotR5WD1SxX3pYp6WKyBgs',
      'D8IfpaQt',
      '-----END CERTIFICATE-----',
    ].join('\n');

    recordIssuedCertificate(pem);

    const stored = getStoredCertificateExpiry();
    expect(stored?.toISOString()).toBe('2126-09-14T06:56:53.000Z');
    expect(isStoredCertificateExpired()).toBe(false);
  });

  it('survives an unparseable certificate — the reactive path still covers the user', () => {
    expect(() => recordIssuedCertificate('not a certificate')).not.toThrow();
    expect(getStoredCertificateExpiry()).toBeNull();
  });
});
