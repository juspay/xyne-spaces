import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BetaAccessSchema,
  BetaFlagsEnabledSchema,
  CAC_REGISTRY,
  LotusUpdateConfigSchema,
  PlatformUpdateConfigSchema,
} from '@/src/services/cac/schemas';

const platformDefaults = {
  enabled: false,
  mode: 'optional',
  minSupportedVersion: '0.0.0',
  latestVersion: '0.0.0',
  latestBuildNumber: 0,
  title: '',
  message: '',
  storeUrl: '',
};

describe('PlatformUpdateConfigSchema', () => {
  it('applies safe defaults for a missing config', () => {
    assert.deepEqual(PlatformUpdateConfigSchema.parse({}), platformDefaults);
  });

  it('preserves provided values', () => {
    const parsed = PlatformUpdateConfigSchema.parse({
      enabled: true,
      mode: 'force',
      latestVersion: '2.1.0',
      latestBuildNumber: 42,
      storeUrl: 'https://example.test',
    });
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.mode, 'force');
    assert.equal(parsed.latestVersion, '2.1.0');
    assert.equal(parsed.latestBuildNumber, 42);
    assert.equal(parsed.storeUrl, 'https://example.test');
  });

  it('rejects an unknown update mode', () => {
    assert.equal(PlatformUpdateConfigSchema.safeParse({ mode: 'nag' }).success, false);
  });
});

describe('LotusUpdateConfigSchema', () => {
  it('prefaults both platforms to full config defaults', () => {
    assert.deepEqual(LotusUpdateConfigSchema.parse({}), {
      android: platformDefaults,
      ios: platformDefaults,
    });
  });

  it('merges per-platform overrides while still defaulting the other platform', () => {
    const parsed = LotusUpdateConfigSchema.parse({ android: { enabled: true } });
    assert.equal(parsed.android?.enabled, true);
    assert.equal(parsed.android?.mode, 'optional');
    assert.deepEqual(parsed.ios, platformDefaults);
  });
});

describe('CAC_REGISTRY', () => {
  it('registers the lotus update config key with its schema and stale policy', () => {
    const entry = CAC_REGISTRY['lotus_update_config'];
    assert.ok(entry);
    assert.equal(entry.schema, LotusUpdateConfigSchema);
    assert.equal(entry.staleTimeMs, 60_000);
  });
});

describe('beta keys refuse to invent a value', () => {
  it('rejects a malformed grant list instead of reading it as "no access"', () => {
    // Swallowing this into [] is indistinguishable from a real empty grant,
    // which the revocation gate acts on by taking the user's features away.
    assert.equal(BetaFlagsEnabledSchema.safeParse('ui.shell').success, false);
    assert.equal(BetaFlagsEnabledSchema.safeParse([1, 2]).success, false);
    assert.equal(BetaFlagsEnabledSchema.safeParse({}).success, false);
  });

  it('still accepts a genuinely empty grant list', () => {
    // Revocation has to keep working: removing someone's override resolves to
    // the default `[]`, and that must be honoured.
    assert.deepEqual(BetaFlagsEnabledSchema.parse([]), []);
  });

  it('marks the keys that can subtract as requiring a value', () => {
    assert.equal(CAC_REGISTRY['lotus_beta_flags_enabled'].requireValue, true);
    assert.equal(CAC_REGISTRY['lotus_beta_flag_catalog'].requireValue, true);

    // These two cannot take anything away, so a fallback is safe.
    assert.equal(CAC_REGISTRY['lotus_beta_access'].requireValue, false);
    assert.equal(CAC_REGISTRY['lotus_update_config'].requireValue, false);
  });

  it('keeps the access switch forgiving, since its fallback only ever adds', () => {
    assert.deepEqual(BetaAccessSchema.parse('nonsense'), { force: [], disabled: false });
  });

  it('states every fallback rather than deriving it by parsing {}', () => {
    for (const key of Object.keys(CAC_REGISTRY) as (keyof typeof CAC_REGISTRY)[]) {
      assert.notEqual(CAC_REGISTRY[key].fallback, undefined, `${key} has no fallback`);
    }
  });
});
