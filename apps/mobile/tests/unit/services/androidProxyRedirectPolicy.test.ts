import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const proxyPath = resolve(process.cwd(), 'plugins/android-modules/proxy/MtlsProxyServer.kt');

test('Android proxy does not let OkHttp follow redirects implicitly', () => {
  const source = readFileSync(proxyPath, 'utf8');

  assert.match(source, /\.followRedirects\(false\)/);
  assert.match(source, /\.followSslRedirects\(false\)/);
});

test('Android proxy follows only bounded redirects to approved targets', () => {
  const source = readFileSync(proxyPath, 'utf8');

  assert.match(source, /private const val MAX_REDIRECTS = 3/);
  assert.match(source, /executeApprovedRequest\(okHttp, requestBuilder\.build\(\)\)/);
  assert.match(source, /!isAllowedTarget\(redirectedTarget\)/);
  assert.match(source, /redirect limit exceeded/);
});
