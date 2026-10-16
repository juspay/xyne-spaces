import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const pluginSource = readFileSync(
  resolve(process.cwd(), 'plugins/withAndroidAppConfig.cjs'),
  'utf8',
);

describe('Android app signing configuration', () => {
  it('does not depend on a repository keystore for debug builds', () => {
    assert.doesNotMatch(pluginSource, /assets\/secrets\/debug\.key\.store/);
    assert.match(pluginSource, /LOTUS_DEBUG_KEYSTORE_FILE/);
    assert.match(pluginSource, /'debug\.keystore'/);
  });
});

describe('native remote logging default', () => {
  it('treats the community store app as a production variant, like src/config.ts', () => {
    // Otherwise Crashlytics stays off in community release builds until JS starts,
    // dropping native and startup crashes.
    assert.match(pluginSource, /\['prod', 'community'\]\.includes\(config\.extra\?\.appVariant\)/);
    const iosSource = readFileSync(
      resolve(process.cwd(), 'plugins/withNotificationServiceIOS.cjs'),
      'utf8',
    );
    assert.match(iosSource, /variantKey === 'prod' \|\| variantKey === 'community'/);
  });
});
