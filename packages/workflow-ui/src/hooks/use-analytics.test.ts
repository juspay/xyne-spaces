import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../components/provider/WorkflowUIProvider.js';
import { useAnalytics } from './use-analytics.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

function makeClient(overrides: Partial<WorkflowClient> = {}): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    schema: {} as WorkflowClient['schema'],
    uploads: {} as WorkflowClient['uploads'],
    credentials: {} as WorkflowClient['credentials'],
    workflows: {
      list: vi.fn().mockResolvedValue([
        { id: 'wf-1', status: 'ACTIVE', eventType: 'MANUAL', metadata: JSON.stringify({ name: 'Pipeline' }), config: JSON.stringify({ trigger: { type: 'MANUAL' }, steps: [{ id: 'step_a', type: 'CODE' }, { id: 'step_b', type: 'WAIT' }] }) },
        { id: 'wf-2', status: 'INACTIVE', eventType: 'WEBHOOK', metadata: JSON.stringify({ name: 'Agent' }), config: JSON.stringify({ trigger: { type: 'WEBHOOK' }, steps: [{ id: 'step_c', type: 'CODE' }] }) },
      ]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      validate: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      trigger: vi.fn(),
    },
    executions: {
      list: vi.fn().mockResolvedValue({
        items: [
          { id: 'ex-1', workflowId: 'wf-1', status: 'COMPLETED', createdAt: new Date() },
          { id: 'ex-2', workflowId: 'wf-1', status: 'FAILED', createdAt: new Date() },
          { id: 'ex-3', workflowId: 'wf-2', status: 'COMPLETED', createdAt: new Date() },
        ],
        nextCursor: undefined,
      }),
      get: vi.fn(),
      resume: vi.fn(),
      rerun: vi.fn(),
      cancel: vi.fn(),
    },
    analytics: {
      summary: vi.fn().mockResolvedValue({
        totalRuns: 3,
        successRate: 67,
        byStatus: { COMPLETED: 2, FAILED: 1 },
        runsByDay: [],
        byWorkflow: [
          { workflowId: 'wf-1', name: 'Pipeline', status: 'ACTIVE', eventType: 'MANUAL', totalRuns: 2, failedRuns: 1, failureRate: 50, lastRunAt: new Date().toISOString() },
          { workflowId: 'wf-2', name: 'Agent', status: 'INACTIVE', eventType: 'WEBHOOK', totalRuns: 1, failedRuns: 0, failureRate: 0, lastRunAt: new Date().toISOString() },
        ],
        recentFailures: [],
        activeWorkflows: 1,
        totalWorkflows: 2,
      }),
      topErrors: vi.fn().mockResolvedValue({ topErrors: [] }),
    },
    ...overrides,
  } as unknown as WorkflowClient;
}

function wrapper(client: WorkflowClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(WorkflowUIProvider, { client, children });
}

describe('useAnalytics', () => {
  it('returns aggregated stats from executions and workflows', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalytics(7), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data?.totalRuns).toBe(3);
    expect(result.current.data?.byStatus['COMPLETED']).toBe(2);
    expect(result.current.data?.byStatus['FAILED']).toBe(1);
    expect(result.current.data?.successRate).toBe(67);
  });

  it('computes byWorkflow sorted by run count', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAnalytics(7), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const wf = result.current.data?.byWorkflow[0];
    expect(wf?.workflowId).toBe('wf-1');
    expect(wf?.name).toBe('Pipeline');
    expect(wf?.totalRuns).toBe(2);
    expect(wf?.failureRate).toBe(50);
  });

  it('returns error when fetch fails', async () => {
    const client = makeClient({
      analytics: {
        summary: vi.fn().mockRejectedValue(new Error('fetch failed')),
        topErrors: vi.fn().mockResolvedValue({ topErrors: [] }),
      } as unknown as WorkflowClient['analytics'],
    });
    const { result } = renderHook(() => useAnalytics(7), { wrapper: wrapper(client) });

    // Wait for the error itself rather than for loading to end: the query
    // retries once before giving up, so it is still pending for a moment after
    // the first rejection.
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error), { timeout: 5000 });

    expect(result.current.data).toBeNull();
  });

  it('forwards folderId to analytics.summary', async () => {
    const client = makeClient();
    renderHook(() => useAnalytics(7, 'folder-abc'), { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(client.analytics.summary).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'folder-abc' }),
        // Reads carry an abort signal now, so a superseded one really stops.
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});
