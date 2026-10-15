import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The Android network client is compiled from the config-plugin source rather
 * than imported into the TypeScript test graph. Keep the server-trust policy
 * covered at this source boundary so a future pinning change cannot silently
 * reintroduce the enrollment failure or a trust-all fallback.
 */
const SOURCE = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/http/MtlsNetworkClient.kt'),
  'utf8',
);
const INTEGRITY_PLUGIN_SOURCE = readFileSync(
  resolve(process.cwd(), 'plugins/with-integrity-module-android/index.cjs'),
  'utf8',
);

describe('Android mTLS server trust policy', () => {
  it('uses the platform trust anchors for server TLS', () => {
    assert.match(
      SOURCE,
      /val trustManager = buildSystemTrustManager\(\)/,
      'mTLS must validate the server with Android system trust anchors',
    );
    assert.doesNotMatch(
      SOURCE,
      /buildPinnedTrustManager|buildCompositeTrustManager/,
      'mTLS must not use stale CA pinning or a silent fallback trust manager',
    );
    assert.doesNotMatch(
      SOURCE,
      /trustedCaPem|TRUSTED_CA_PEM/,
      'unused client-CA material must not imply a server-trust policy',
    );
  });

  it('keeps hostname verification and the client identity separate', () => {
    assert.match(
      SOURCE,
      /HttpsURLConnection\.getDefaultHostnameVerifier\(\)/,
      'server identity must still be checked by the platform hostname verifier',
    );
    assert.match(
      SOURCE,
      /kmf\.init\(keyStore, null\)/,
      'the enrolled client certificate must remain the mTLS client identity',
    );
    assert.doesNotMatch(
      SOURCE,
      /TrustAll|allowAll|X509TrustManager\s*\{[\s\S]*checkServerTrusted\s*\([^)]*\)\s*\{\s*\}/,
      'server certificate validation must not be disabled',
    );
  });

  it('does not keep removed server-trust constants in generated release rules', () => {
    assert.doesNotMatch(
      INTEGRITY_PLUGIN_SOURCE,
      /TRUSTED_CA_PEM/,
      'R8 rules must not preserve removed certificate constants',
    );
  });
});
