import { describe, expect, it, vi } from 'vitest';

// The picker module pulls in browser-only config; these tests only need the
// pure snapshot → overrides mapping.
vi.mock('../../Chat/XyneAISidebar/components/ContextPickerPanel', () => ({
  toAttachedContext: (): unknown[] => [],
}));

import {
  EMPTY_COMPOSER_CONTEXT,
  modelOverridesFrom,
  toStreamOverrides,
  type ComposerContext,
} from '../composerContext';

const pinned: ComposerContext = {
  ...EMPTY_COMPOSER_CONTEXT,
  model: 'claude-sonnet-4-5',
  modelProvider: 'litellm',
  thinkingLevel: 'high',
};

describe('modelOverridesFrom (XYNE-66322: regenerate / edit keep the pin)', () => {
  it('carries the composer pin, its provider and thinking level', () => {
    expect(modelOverridesFrom(pinned)).toEqual({
      model: 'claude-sonnet-4-5',
      modelProvider: 'litellm',
      thinkingLevel: 'high',
    });
  });

  it('sends an explicit null model when the composer is on Auto', () => {
    const overrides = modelOverridesFrom(EMPTY_COMPOSER_CONTEXT);
    expect('model' in overrides).toBe(true);
    expect(overrides.model).toBeNull();
    expect(overrides.modelProvider).toBeNull();
  });

  it('sends an explicit null model when there is no composer snapshot (other agent)', () => {
    expect(modelOverridesFrom(null)).toEqual({ model: null, modelProvider: null });
  });

  it('marks a local-harness pin as a device run', () => {
    expect(
      modelOverridesFrom({
        ...EMPTY_COMPOSER_CONTEXT,
        model: 'local-harness:claude-code',
        modelProvider: 'local-harness',
        runsOnDevice: true,
      }),
    ).toMatchObject({
      model: 'local-harness:claude-code',
      modelProvider: 'local-harness',
      expectOnDevice: true,
    });
  });
});

describe('toStreamOverrides (XYNE-66324: device expectation rides the submit)', () => {
  it('flags Auto-on-device runs', () => {
    const overrides = toStreamOverrides({ ...EMPTY_COMPOSER_CONTEXT, runsOnDevice: true });
    expect(overrides.expectOnDevice).toBe(true);
    expect('model' in overrides).toBe(false);
  });

  it('leaves server runs unflagged', () => {
    expect(toStreamOverrides(pinned).expectOnDevice).toBeUndefined();
  });
});
