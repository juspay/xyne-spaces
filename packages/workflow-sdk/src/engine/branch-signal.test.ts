import { describe, it, expect } from 'vitest';
import { BranchSignal, blockedJumpError, isJumpingStep } from './branch-signal.js';

describe('BranchSignal', () => {
  const signal = { kind: 'goto', target: 'menu', value: { screen: 'rides' } } as const;

  it('names the jump in its message', () => {
    expect(new BranchSignal(signal).message).toBe('GO_TO to "menu"');
    expect(new BranchSignal({ ...signal, kind: 'finish' }).message).toBe('FINISH to "menu"');
  });

  it('is() recognises signals, including ones from another copy of the package', () => {
    expect(BranchSignal.is(new BranchSignal(signal))).toBe(true);
    const foreign = Object.assign(new Error('GO_TO to "menu"'), { name: 'BranchSignal', signal });
    expect(BranchSignal.is(foreign)).toBe(true);
    expect(BranchSignal.is(new Error('boom'))).toBe(false);
    expect(BranchSignal.is('BranchSignal')).toBe(false);
  });

  describe('fromRecord', () => {
    it('reads back a saved jump', () => {
      const restored = BranchSignal.fromRecord({ type: 'GO_TO', output: {}, signal });
      expect(restored?.signal).toEqual(signal);
    });

    it('returns null for a step that ended normally', () => {
      expect(BranchSignal.fromRecord({ type: 'ECHO', output: { echoed: 'hi' } })).toBeNull();
      expect(BranchSignal.fromRecord(null)).toBeNull();
      expect(BranchSignal.fromRecord(undefined)).toBeNull();
    });

    it('ignores a malformed signal', () => {
      expect(BranchSignal.fromRecord({ signal: { kind: 'jump', target: 'menu', value: {} } })).toBeNull();
      expect(BranchSignal.fromRecord({ signal: { kind: 'finish', target: 3, value: {} } })).toBeNull();
      expect(BranchSignal.fromRecord({ signal: { kind: 'finish', target: 'menu', value: [] } })).toBeNull();
    });
  });
});

describe('isJumpingStep', () => {
  it('matches steps that declare a jump kind', () => {
    expect(isJumpingStep({ jumpKind: 'goto' })).toBe(true);
    expect(isJumpingStep({ jumpKind: 'finish' })).toBe(true);
    expect(isJumpingStep({ jumpKind: 'other' })).toBe(false);
    expect(isJumpingStep({})).toBe(false);
    expect(isJumpingStep(null)).toBe(false);
  });
});

describe('blockedJumpError', () => {
  it('explains why the jump cannot leave the branch', () => {
    const error = blockedJumpError({ kind: 'finish', target: 'menu', value: {} }, 'PARALLEL');
    expect(error.message).toBe(
      'FINISH to "menu" can\'t leave a PARALLEL branch: its branches run at the same time.',
    );
  });
});
