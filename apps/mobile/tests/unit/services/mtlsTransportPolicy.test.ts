import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

import { isApprovedTransportDestination } from '../../../src/utils/mtlsDestinationPolicy';

const API_ORIGIN = 'https://app.spaces.xyne.juspay.net';

const MTLS_HTTP_CLIENT_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/utils/mtlsHttpClient.ts'),
  'utf8',
);

describe('mTLS transport destination policy', () => {
  it('enforces the policy before preparing or sending a request', () => {
    assert.match(MTLS_HTTP_CLIENT_SOURCE, /if \(!isApprovedTransportDestination\(url\)\)/);
    assert.match(
      MTLS_HTTP_CLIENT_SOURCE,
      /if \(!isApprovedTransportDestination\(url\)\) \{[\s\S]*?const headers = await prepareHeadersForTransport/s,
    );
  });

  it('allows the configured API origin regardless of path or query', () => {
    assert.equal(
      isApprovedTransportDestination(`${API_ORIGIN}/attachments/a?download=1`, API_ORIGIN),
      true,
    );
  });

  it('allows loopback HTTP/HTTPS for local development', () => {
    assert.equal(
      isApprovedTransportDestination('http://localhost:3001/api/health', API_ORIGIN),
      true,
    );
    assert.equal(
      isApprovedTransportDestination('https://127.0.0.1:8443/api/health', API_ORIGIN),
      true,
    );
    assert.equal(isApprovedTransportDestination('http://[::1]:8080/api/health', API_ORIGIN), true);
  });

  it('rejects lookalike, alternate-port, and non-API origins', () => {
    assert.equal(
      isApprovedTransportDestination('https://app.spaces.xyne.juspay.net.evil.test/', API_ORIGIN),
      false,
    );
    assert.equal(
      isApprovedTransportDestination('https://app.spaces.xyne.juspay.net:444/', API_ORIGIN),
      false,
    );
    assert.equal(
      isApprovedTransportDestination('https://attacker.test/collect', API_ORIGIN),
      false,
    );
  });

  it('rejects cleartext and credentials on non-loopback destinations', () => {
    assert.equal(
      isApprovedTransportDestination('http://app.spaces.xyne.juspay.net/api', API_ORIGIN),
      false,
    );
    assert.equal(
      isApprovedTransportDestination(
        `https://user:pass@${new URL(API_ORIGIN).host}/api`,
        API_ORIGIN,
      ),
      false,
    );
  });
});
