import { afterEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../../clients/apiClient', () => ({ apiInstance: client }));
import { dependencyApi, subscribeDependencyInvalidation } from '../api';

const settings = { strength: 'HARD' as const, gatedStageId: 'gate', satisfiedStageId: 'satisfied' };
afterEach(() => vi.resetAllMocks());
describe('dependency REST transport', () => {
  it('passes AbortSignal and IDs to authorized batch reads without invalidating', async () => {
    client.post.mockResolvedValue({ data: { edges: [] } });
    const changed = vi.fn();
    const stop = subscribeDependencyInvalidation(changed);
    const signal = new AbortController().signal;
    expect(await dependencyApi.read(['ticket'], signal)).toEqual({ edges: [] });
    expect(client.post).toHaveBeenCalledWith(
      '/dependencies/read',
      { ticketIds: ['ticket'] },
      { signal },
    );
    expect(changed).not.toHaveBeenCalled();
    stop();
  });
  it('creates a directed typed dependency and invalidates only after success', async () => {
    const changed = vi.fn();
    const stop = subscribeDependencyInvalidation(changed);
    client.post.mockResolvedValue({ data: { id: 'edge' } });
    await dependencyApi.create('blocker', 'dependent', settings);
    expect(client.post).toHaveBeenCalledWith('/dependencies', {
      sourceTicketId: 'blocker',
      targetTicketId: 'dependent',
      ...settings,
    });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
  it('does not invalidate or swallow a failed write', async () => {
    const changed = vi.fn();
    const stop = subscribeDependencyInvalidation(changed);
    client.patch.mockRejectedValue(new Error('403'));
    await expect(dependencyApi.update('edge', settings, 'reason')).rejects.toThrow('403');
    expect(changed).not.toHaveBeenCalled();
    stop();
  });
  it('does not send a BLOCKS satisfaction stage to CHILD gating', async () => {
    client.patch.mockResolvedValue({ data: {} });
    await dependencyApi.updateChild('child/id', settings, 'authorized override');
    expect(client.patch).toHaveBeenCalledWith('/sub-ticket-gating/child%2Fid', {
      strength: 'HARD',
      gatedStageId: 'gate',
      reason: 'authorized override',
    });
  });
  it('preserves required reasons in update, delete and manual-satisfaction calls', async () => {
    client.patch.mockResolvedValue({});
    client.delete.mockResolvedValue({});
    client.post.mockResolvedValue({});
    await dependencyApi.update('edge/id', settings, 'reason');
    await dependencyApi.remove('edge/id', 'reason');
    await dependencyApi.satisfy('edge/id', 'reason');
    expect(client.patch).toHaveBeenCalledWith('/dependencies/edge%2Fid', {
      ...settings,
      reason: 'reason',
    });
    expect(client.delete).toHaveBeenCalledWith('/dependencies/edge%2Fid', {
      data: { reason: 'reason' },
    });
    expect(client.post).toHaveBeenCalledWith('/dependencies/edge%2Fid/satisfy', {
      reason: 'reason',
    });
  });
  it('removes invalidation subscriptions on cleanup', async () => {
    const changed = vi.fn();
    const stop = subscribeDependencyInvalidation(changed);
    stop();
    client.post.mockResolvedValue({});
    await dependencyApi.create('blocker', 'dependent', settings);
    expect(changed).not.toHaveBeenCalled();
  });
});
