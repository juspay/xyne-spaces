import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const pluginPath = resolve(process.cwd(), 'plugins/with-certificate-module-android/index.cjs');
const networkSecurityConfigPath = resolve(
  process.cwd(),
  'plugins/android-modules/network_security_config.xml',
);

test('Android production policy does not enable global cleartext traffic', () => {
  const source = readFileSync(pluginPath, 'utf8');

  assert.match(source, /android:usesCleartextTraffic.*variantKey === 'dev' \? 'true' : 'false'/s);
  assert.doesNotMatch(
    source,
    /application\.\$\['android:usesCleartextTraffic'\]\s*=\s*['"]true['"]/,
  );
  assert.match(source, /android:networkSecurityConfig/);
});

test('Android production cleartext exception is limited to loopback', () => {
  const source = readFileSync(networkSecurityConfigPath, 'utf8');

  assert.match(source, /<base-config cleartextTrafficPermitted="false"\s*\/>/);
  assert.match(source, /<domain[^>]*>localhost<\/domain>/);
  assert.match(source, /<domain[^>]*>127\.0\.0\.1<\/domain>/);
  assert.equal((source.match(/cleartextTrafficPermitted="true"/g) || []).length, 1);
});
