import { describe, expect, it, vi } from 'vitest';
import { DependencyConsentController, dependencyGateRefusal, runDependencyMutation } from '../gate';

const soft = {
  type: 'error',
  error: {
    message: 'private ignored',
    details: {
      code: 'DEPENDENCY_REASON_REQUIRED',
      softCount: 2,
      hardCount: 0,
      canAdminOverride: false,
      edges: ['secret-id'],
      reason: 'secret-reason',
      author: 'secret-author',
    },
  },
};
const hard = {
  type: 'error',
  error: { details: { code: 'DEPENDENCY_HARD_GATE', hardCount: 1, canAdminOverride: true } },
};
const signal = () => new AbortController().signal;
describe('stage consent retry contract (isolated, not application acceptance)', () => {
  it('copies counts only and does not match arbitrary error messages', () => {
    expect(dependencyGateRefusal(soft)).toEqual({
      softCount: 2,
      hardCount: 0,
      canAdminOverride: false,
    });
    expect(
      dependencyGateRefusal({ type: 'error', error: { message: 'DEPENDENCY_REASON_REQUIRED' } }),
    ).toBeNull();
    expect(dependencyGateRefusal({ type: 'error', error: { details: [] } })).toBeNull();
  });
  it('does not prompt on success or ordinary authorization errors', async () => {
    const consent = vi.fn();
    for (const result of [
      { type: 'success' },
      { type: 'error', error: { message: 'Forbidden' } },
    ]) {
      expect(await runDependencyMutation(() => Promise.resolve(result), consent, signal())).toBe(
        result,
      );
    }
    expect(consent).not.toHaveBeenCalled();
  });
  it('rolls back before consent, trims the reason and retries once', async () => {
    const order: string[] = [];
    const execute = vi.fn().mockResolvedValueOnce(soft).mockResolvedValueOnce({ type: 'success' });
    const consent = vi.fn(() => {
      order.push('consent');
      return Promise.resolve({ reason: '  Approved risk  ', adminOverride: true });
    });
    await runDependencyMutation(execute, consent, signal(), () => {
      order.push('rollback');
    });
    expect(order).toEqual(['rollback', 'consent']);
    expect(execute.mock.calls).toEqual([[], [{ reason: 'Approved risk' }]]);
  });
  it('does not retry cancelled, blank, oversized or implicit hard consent', async () => {
    for (const override of [
      null,
      { reason: '  ' },
      { reason: 'x'.repeat(2001) },
      { reason: 'risk' },
    ]) {
      const execute = vi.fn().mockResolvedValue(hard);
      expect(
        (await runDependencyMutation(execute, () => Promise.resolve(override), signal()))?.type,
      ).toBe('error');
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });
  it('does not retry after an identity replacement even before effect cleanup', async () => {
    let current = true;
    const execute = vi.fn().mockResolvedValue(soft);
    const consent = vi.fn(() => {
      current = false;
      return Promise.resolve({ reason: 'risk' });
    });
    await runDependencyMutation(execute, consent, signal(), undefined, () => current);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('requires server eligibility as well as explicit hard consent', async () => {
    const denied = {
      ...hard,
      error: { details: { ...hard.error.details, canAdminOverride: false } },
    };
    const execute = vi.fn().mockResolvedValue(denied);
    await runDependencyMutation(
      execute,
      () => Promise.resolve({ reason: 'risk', adminOverride: true }),
      signal(),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('returns a fresh refusal without recursively prompting or retrying', async () => {
    const execute = vi.fn().mockResolvedValue(hard);
    const consent = vi.fn(() => Promise.resolve({ reason: 'risk', adminOverride: true }));
    const rollback = vi.fn();
    expect(await runDependencyMutation(execute, consent, signal(), rollback)).toBe(hard);
    expect(execute.mock.calls).toEqual([[], [{ reason: 'risk', adminOverride: true }]]);
    expect(consent).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(2);
  });
  it('cancels identity/unmount/replacement aborts before retry', async () => {
    const controller = new AbortController();
    const execute = vi.fn().mockResolvedValue(soft);
    const result = await runDependencyMutation(
      execute,
      () => {
        controller.abort();
        return Promise.resolve({ reason: 'stale consent' });
      },
      controller.signal,
    );
    expect(result?.error?.details).toEqual({ code: 'DEPENDENCY_CANCELLED' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not execute a previously aborted intent', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn();
    await runDependencyMutation(execute, vi.fn(), controller.signal);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('consent lifecycle', () => {
  it('resolves replaced and aborted requests, ignores stale dialog callbacks', async () => {
    const host = new DependencyConsentController();
    const gate = dependencyGateRefusal(soft)!;
    const first = host.ask('identity-a', gate, signal());
    const stale = host.getSnapshot()!.token;
    const controller = new AbortController();
    const second = host.ask('identity-b', gate, controller.signal);
    expect(await first).toBeNull();
    host.finish(stale, { reason: 'stale' });
    expect(host.getSnapshot()?.scope).toBe('identity-b');
    controller.abort();
    expect(await second).toBeNull();
    expect(host.getSnapshot()).toBeNull();
  });
  it('does not resolve an invalid reason but clears private input after valid completion', async () => {
    const host = new DependencyConsentController();
    const promise = host.ask('identity', dependencyGateRefusal(hard)!, signal());
    const token = host.getSnapshot()!.token;
    host.finish(token, { reason: 'risk' });
    expect(host.getSnapshot()).not.toBeNull();
    host.finish(token, { reason: 'private reason', adminOverride: true });
    expect(await promise).toEqual({ reason: 'private reason', adminOverride: true });
    expect(host.getSnapshot()).toBeNull();
  });
});
