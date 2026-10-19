import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { patchMainApplication } = require('../../plugins/withReactNativeShadowTreeFixAndroid.cjs');

test('Expo prebuild keeps the tree fix between native loading and runtime startup', () => {
  const source = `override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }`;
  const patched = patchMainApplication(source);
  const nativeLoad = patched.indexOf('loadReactNative(this)');
  const fix = patched.indexOf('override fun fixFindShadowNodeByTagRaceCondition()');
  const lifecycle = patched.indexOf('ApplicationLifecycleDispatcher.onApplicationCreate(this)');
  assert.ok(nativeLoad < fix && fix < lifecycle);
  assert.equal(patchMainApplication(patched), patched);
});

test('a changed native startup template fails prebuild instead of dropping the fix', () => {
  assert.throws(() => patchMainApplication('override fun onCreate() {}'), /exactly one/);
  assert.throws(
    () => patchMainApplication('loadReactNative(this)\nloadReactNative(this)\n'),
    /exactly one/,
  );
});
