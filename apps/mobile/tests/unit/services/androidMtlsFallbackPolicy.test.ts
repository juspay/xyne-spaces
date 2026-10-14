import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const factoryPath = resolve(process.cwd(), 'plugins/android-modules/http/MtlsOkHttpFactory.kt');

test('Android OkHttp fallback is limited to devices without a client identity', () => {
  const source = readFileSync(factoryPath, 'utf8');

  assert.match(source, /CertificateManager\.initialize\(context\)\.hasPrivateKey\(\)/);
  assert.match(source, /if \(hasClientIdentity\) \{[\s\S]*throw e/);
  assert.match(source, /using default OkHttpClient/);
});

test('Android mTLS factory does not unconditionally downgrade after setup failure', () => {
  const source = readFileSync(factoryPath, 'utf8');

  assert.doesNotMatch(
    source,
    /catch \(e: Exception\) \{\s*Log\.w\(TAG, "mTLS not available[\s\S]*createClientBuilder\(context\)\.build\(\)/,
  );
});
