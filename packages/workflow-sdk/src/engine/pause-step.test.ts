import { describe, it, expect } from 'vitest';
import { PauseStep } from './pause-step.js';
import { GateCategory } from '../types/known-types.js';

describe('PauseStep', () => {
  it('creates with reason only', () => {
    const err = new PauseStep('waiting for approval', { category: GateCategory.WaitingOnApprover });
    expect(err.message).toBe('Step paused: waiting for approval');
    expect(err.name).toBe('PauseStep');
    expect(err.externalRef).toBeUndefined();
    expect(err.statePatch).toBeUndefined();
    expect(err._pausePath).toEqual([]);
  });

  it('creates with externalRef', () => {
    const err = new PauseStep('webhook', { category: GateCategory.WaitingOnApiCall, externalRef: 'wh_123' });
    expect(err.externalRef).toBe('wh_123');
    expect(err.statePatch).toBeUndefined();
  });

  it('creates with statePatch', () => {
    const patch = { attempt: 2 };
    const err = new PauseStep('retrying', { category: GateCategory.WaitingOnApprover, statePatch: patch });
    expect(err.statePatch).toEqual({ attempt: 2 });
  });

  it('creates with both externalRef and statePatch', () => {
    const err = new PauseStep('full', {
      category: GateCategory.WaitingOnApiCall,
      externalRef: 'ext_1',
      statePatch: { key: 'value' },
    });
    expect(err.externalRef).toBe('ext_1');
    expect(err.statePatch).toEqual({ key: 'value' });
  });

  it('is an instance of Error', () => {
    const err = new PauseStep('test', { category: GateCategory.WaitingOnApprover });
    expect(err).toBeInstanceOf(Error);
  });

  describe('PauseStep.is()', () => {
    it('returns true for PauseStep instance', () => {
      const err = new PauseStep('test', { category: GateCategory.WaitingOnApprover });
      expect(PauseStep.is(err)).toBe(true);
    });

    it('returns true for Error with name PauseStep (cross-realm)', () => {
      const err = new Error('Step paused: cross-realm');
      err.name = 'PauseStep';
      expect(PauseStep.is(err)).toBe(true);
    });

    it('returns false for regular Error', () => {
      expect(PauseStep.is(new Error('nope'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(PauseStep.is(null)).toBe(false);
      expect(PauseStep.is(undefined)).toBe(false);
      expect(PauseStep.is('string')).toBe(false);
      expect(PauseStep.is(42)).toBe(false);
    });
  });
});
