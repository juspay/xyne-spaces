import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../apps/dashboard/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../apps/dashboard/src/config.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replaceAll('import.meta.env', '__env'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function config(env, origin = 'http://dev.example.test:5174') {
  const exports = {};
  vm.runInNewContext(code, { exports, window: { location: new URL(origin) }, __env: env });
  return exports;
}

test('opt-in development proxy retains the browser origin and port for API and Zero', () => {
  const result = config({ DEV: true, VITE_DEV_PROXY: 'true', VITE_ENABLE_REMOTE_LOGGING: 'false' });
  assert.equal(result.API_BASE_URL, '/api');
  assert.equal(result.VITE_ZERO_SERVER, 'http://dev.example.test:5174/zero');
  assert.equal(result.ENABLE_REMOTE_LOGGING, false);
});

test('production URLs stay unchanged even if the development proxy flag is set', () => {
  const result = config({ DEV: false, VITE_DEV_PROXY: 'true' }, 'https://app.example.test');
  assert.equal(result.API_BASE_URL, 'https://app.example.test/api');
  assert.equal(result.VITE_ZERO_SERVER, 'https://app.example.test/zero');
  assert.equal(result.ENABLE_REMOTE_LOGGING, true);
});

test('explicit lane overrides retain precedence over the development proxy', () => {
  const result = config({ DEV: true, VITE_DEV_PROXY: 'true', VITE_API_BASE_OVERRIDE: '/sdlc-api', VITE_ZERO_PATH: '/sdlc-zero' });
  assert.equal(result.API_BASE_URL, '/sdlc-api');
  assert.equal(result.VITE_ZERO_SERVER, 'http://dev.example.test:5174/sdlc-zero');
});

test('localhost defaults remain available without the proxy flag', () => {
  const result = config({ DEV: true }, 'http://localhost:5173');
  assert.equal(result.API_BASE_URL, 'http://localhost:3001/api');
  assert.equal(result.VITE_ZERO_SERVER, 'http://localhost:4848/zero');
});
