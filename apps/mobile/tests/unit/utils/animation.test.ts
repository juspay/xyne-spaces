import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAnimationState,
  getAnimationValueMergedConfig,
  getAnimationValueProperty,
  getCombinedAnimationDisabledState,
  getIsAnimationDisabledValue,
  getRootAnimationState,
  isAnimationDisabled,
  shouldDisableAll,
} from '@/src/utils/animation';

describe('isAnimationDisabled', () => {
  it('treats the boolean false and the "disabled" literal as disabled', () => {
    assert.equal(isAnimationDisabled(false), true);
    assert.equal(isAnimationDisabled('disabled'), true);
  });

  it('reads the state field on config objects', () => {
    assert.equal(isAnimationDisabled({ state: false }), true);
    assert.equal(isAnimationDisabled({ state: 'disabled' }), true);
    assert.equal(isAnimationDisabled({ state: true }), false);
    assert.equal(isAnimationDisabled({ color: 'red' }), false);
  });

  it('treats true, undefined, and non-state strings as enabled', () => {
    assert.equal(isAnimationDisabled(true), false);
    assert.equal(isAnimationDisabled(undefined), false);
    // "disable-all" is a root-only literal; the base checker does not act on it.
    assert.equal(isAnimationDisabled('disable-all' as never), false);
  });
});

describe('shouldDisableAll', () => {
  it('only fires for the disable-all literal or state', () => {
    assert.equal(shouldDisableAll('disable-all'), true);
    assert.equal(shouldDisableAll({ state: 'disable-all' }), true);
  });

  it('does not fire for plain disabled or enabled configs', () => {
    assert.equal(shouldDisableAll('disabled'), false);
    assert.equal(shouldDisableAll(false), false);
    assert.equal(shouldDisableAll({ state: 'disabled' }), false);
    assert.equal(shouldDisableAll(undefined), false);
  });
});

describe('getAnimationState', () => {
  it('extracts config from objects regardless of disabled state', () => {
    const state = getAnimationState({ state: false, color: 'red' });
    assert.deepEqual(state.animationConfig, { state: false, color: 'red' });
    assert.equal(state.isAnimationDisabled, true);
  });

  it('returns an undefined config for primitive inputs', () => {
    assert.deepEqual(getAnimationState(false), {
      animationConfig: undefined,
      isAnimationDisabled: true,
    });
    assert.deepEqual(getAnimationState(undefined), {
      animationConfig: undefined,
      isAnimationDisabled: false,
    });
  });
});

describe('getRootAnimationState', () => {
  it('cascades disable-all into both disabled flags', () => {
    assert.deepEqual(getRootAnimationState('disable-all'), {
      animationConfig: undefined,
      isAnimationDisabled: true,
      isAllAnimationsDisabled: true,
    });
  });

  it('keeps config while marking a disable-all state object', () => {
    const state = getRootAnimationState({ state: 'disable-all', color: 'blue' });
    assert.deepEqual(state.animationConfig, { state: 'disable-all', color: 'blue' });
    assert.equal(state.isAnimationDisabled, true);
    assert.equal(state.isAllAnimationsDisabled, true);
  });

  it('disables only this node for a plain disabled state', () => {
    const state = getRootAnimationState({ state: 'disabled' });
    assert.equal(state.isAnimationDisabled, true);
    assert.equal(state.isAllAnimationsDisabled, false);
  });

  it('leaves enabled configs untouched', () => {
    const state = getRootAnimationState({ color: 'green' });
    assert.deepEqual(state.animationConfig, { color: 'green' });
    assert.equal(state.isAnimationDisabled, false);
    assert.equal(state.isAllAnimationsDisabled, false);
  });
});

describe('getAnimationValueProperty', () => {
  it('returns the default when the animation value is undefined', () => {
    assert.equal(
      getAnimationValueProperty<{ value?: number }, 'value', number>({
        animationValue: undefined,
        property: 'value',
        defaultValue: 0.95,
      }),
      0.95,
    );
  });

  it('returns the property value when present', () => {
    assert.equal(
      getAnimationValueProperty<{ value?: number }, 'value', number>({
        animationValue: { value: 0.5 },
        property: 'value',
        defaultValue: 0.95,
      }),
      0.5,
    );
  });

  it('falls back to the default when the property is missing', () => {
    assert.equal(
      getAnimationValueProperty<{ value?: number }, 'value', number>({
        animationValue: {},
        property: 'value',
        defaultValue: 0.95,
      }),
      0.95,
    );
  });
});

describe('getAnimationValueMergedConfig', () => {
  it('returns the default when the animation value is undefined', () => {
    assert.deepEqual(
      getAnimationValueMergedConfig<{ timingConfig?: { duration: number } }, 'timingConfig'>({
        animationValue: undefined,
        property: 'timingConfig',
        defaultValue: { duration: 150 },
      }),
      { duration: 150 },
    );
  });

  it('merges an object property over the defaults', () => {
    assert.deepEqual(
      getAnimationValueMergedConfig<
        { timingConfig?: { duration: number; easing?: string } },
        'timingConfig'
      >({
        animationValue: { timingConfig: { duration: 300, easing: 'linear' } },
        property: 'timingConfig',
        defaultValue: { duration: 150 },
      }),
      { duration: 300, easing: 'linear' },
    );
  });

  it('returns the default when the property is not an object', () => {
    assert.deepEqual(
      getAnimationValueMergedConfig<{ timingConfig?: { duration: number } }, 'timingConfig'>({
        animationValue: {} as { timingConfig?: { duration: number } },
        property: 'timingConfig',
        defaultValue: { duration: 150 },
      }),
      { duration: 150 },
    );
  });
});

describe('getIsAnimationDisabledValue', () => {
  it('prioritises the all-disabled flag', () => {
    assert.equal(
      getIsAnimationDisabledValue({ isAnimationDisabled: false, isAllAnimationsDisabled: true }),
      true,
    );
  });

  it('honours the local disabled flag next', () => {
    assert.equal(
      getIsAnimationDisabledValue({ isAnimationDisabled: true, isAllAnimationsDisabled: false }),
      true,
    );
  });

  it('reports enabled when neither flag is set', () => {
    assert.equal(
      getIsAnimationDisabledValue({
        isAnimationDisabled: false,
        isAllAnimationsDisabled: undefined,
      }),
      false,
    );
  });
});

describe('getCombinedAnimationDisabledState', () => {
  it('lets a global disable-all win', () => {
    assert.equal(
      getCombinedAnimationDisabledState({
        globalIsAllAnimationsDisabled: true,
        parentIsAllAnimationsDisabled: false,
        ownIsAllAnimationsDisabled: false,
      }),
      true,
    );
  });

  it('lets the parent win when global is not set', () => {
    assert.equal(
      getCombinedAnimationDisabledState({
        globalIsAllAnimationsDisabled: false,
        parentIsAllAnimationsDisabled: true,
        ownIsAllAnimationsDisabled: false,
      }),
      true,
    );
  });

  it('falls back to the own value', () => {
    assert.equal(
      getCombinedAnimationDisabledState({
        parentIsAllAnimationsDisabled: undefined,
        ownIsAllAnimationsDisabled: true,
      }),
      true,
    );
    assert.equal(
      getCombinedAnimationDisabledState({
        parentIsAllAnimationsDisabled: false,
        ownIsAllAnimationsDisabled: false,
      }),
      false,
    );
  });
});
