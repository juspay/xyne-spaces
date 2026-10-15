import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseX509NotAfterFromPem } from '@/src/utils/x509NotAfter';
import {
  evaluateMtlsExpiryWarning,
  MTLS_EXPIRY_WARN_WINDOW_MS,
} from '@/src/services/mtlsCertExpiryPolicy';

/** EC P-256 self-signed cert; notAfter = 2026-10-20T08:21:52.000Z */
const FIXTURE_PEM = `-----BEGIN CERTIFICATE-----
MIIBfDCCASOgAwIBAgIURGmkwsftuYrM9EHbPU4Pq4g+XHkwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbXRscy10ZXN0MB4XDTI2MTAxNTA4MjE1MloXDTI2MTAyMDA4
MjE1MlowFDESMBAGA1UEAwwJbXRscy10ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAE8y28VmtZvP3k6j2FJ8FHbfN1DPMElt4bJ9q+2XSN+ymgjsf3D2e7aM2z
Qu1WeCTjxUZtX7kdmGr/jmjX8cE39KNTMFEwHQYDVR0OBBYEFJIj8uWX/h8O+bnw
r/LCXLn5iwxmMB8GA1UdIwQYMBaAFJIj8uWX/h8O+bnwr/LCXLn5iwxmMA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgLJT9H+5KEu6mtpFm+xvPU34u
FwQqoSuSLrIez7C2AQcCIDlZqRLYzeeG1VS91cP5ACNh2d+XRQJ7PEnaqOHqifkJ
-----END CERTIFICATE-----`;

describe('parseX509NotAfterFromPem', () => {
  it('reads notAfter from a PEM certificate', () => {
    assert.equal(parseX509NotAfterFromPem(FIXTURE_PEM), '2026-10-20T08:21:52.000Z');
  });

  it('returns null for garbage input', () => {
    assert.equal(parseX509NotAfterFromPem('not a cert'), null);
  });
});

describe('evaluateMtlsExpiryWarning', () => {
  const notAfter = '2026-10-20T08:21:52.000Z';
  const notAfterMs = Date.parse(notAfter);

  it('is none when more than 2 days remain', () => {
    const now = notAfterMs - MTLS_EXPIRY_WARN_WINDOW_MS - 60_000;
    assert.deepEqual(evaluateMtlsExpiryWarning(notAfter, now, null), { kind: 'none' });
  });

  it('warns once inside the 2-day window', () => {
    const now = notAfterMs - 36 * 60 * 60 * 1000; // 1.5 days left
    assert.deepEqual(evaluateMtlsExpiryWarning(notAfter, now, null), {
      kind: 'warn',
      notAfterIso: notAfter,
      daysLeft: 2,
      alreadyWarned: false,
    });
  });

  it('marks alreadyWarned when warnedFor matches', () => {
    const now = notAfterMs - 12 * 60 * 60 * 1000;
    const state = evaluateMtlsExpiryWarning(notAfter, now, notAfter);
    assert.equal(state.kind, 'warn');
    if (state.kind === 'warn') {
      assert.equal(state.alreadyWarned, true);
      assert.equal(state.daysLeft, 1);
    }
  });

  it('is none when already expired', () => {
    const now = notAfterMs + 1000;
    assert.deepEqual(evaluateMtlsExpiryWarning(notAfter, now, null), { kind: 'none' });
  });
});
