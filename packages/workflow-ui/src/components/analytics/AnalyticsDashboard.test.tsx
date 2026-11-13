import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { AnalyticsDashboard } from './AnalyticsDashboard.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

function makeClient(): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    schema: {} as WorkflowClient['schema'],
    uploads: {} as WorkflowClient['uploads'],
    credentials: {} as WorkflowClient['credentials'],
    workflows: {
      list: vi.fn().mockResolvedValue([
        { id: 'wf-1', status: 'ACTIVE', eventType: 'MANUAL', metadata: JSON.stringify({ name: 'Pipeline' }), config: JSON.stringify({ trigger: { type: 'MANUAL' }, steps: [{ id: 'step_a', type: 'CODE' }] }) },
      ]),
      counts: vi.fn().mockResolvedValue({ total: 1, byFolder: {} }),
      get: vi.fn(), create: vi.fn(), update: vi.fn(), validate: vi.fn(),
      activate: vi.fn(), deactivate: vi.fn(), trigger: vi.fn(),
    },
    // The dashboard now sources its data from these namespaces (analytics
    // summary for the overview, folders for the Folders tab); the older mock
    // predated them.
    analytics: {
      summary: vi.fn().mockResolvedValue({
        totalRuns: 2,
        successRate: 0.5,
        byStatus: { COMPLETED: 1, FAILED: 1 },
        runsByDay: [],
        byWorkflow: [
          { workflowId: 'wf-1', name: 'Pipeline', status: 'ACTIVE', eventType: 'MANUAL', totalRuns: 2, failedRuns: 1, failureRate: 0.5, lastRunAt: null },
        ],
        recentFailures: [],
        activeWorkflows: 1,
        totalWorkflows: 1,
      }),
      topErrors: vi.fn().mockResolvedValue({ topErrors: [] }),
    },
    folders: {
      list: vi.fn().mockResolvedValue([
        { id: 'fld-1', name: 'Demo', parentId: null },
      ]),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    executions: {
      list: vi.fn().mockResolvedValue({
        items: [
          { id: 'ex-1', workflowId: 'wf-1', status: 'COMPLETED', createdAt: new Date() },
          { id: 'ex-2', workflowId: 'wf-1', status: 'FAILED', createdAt: new Date() },
        ],
        nextCursor: undefined,
      }),
      get: vi.fn().mockResolvedValue({
        id: 'ex-1', workflowId: 'wf-1', status: 'COMPLETED', createdAt: new Date(), steps: [],
      }),
      resume: vi.fn(), rerun: vi.fn(), cancel: vi.fn(),
    },
  } as unknown as WorkflowClient;
}

describe('AnalyticsDashboard', () => {
  it('shows loading spinner initially', () => {
    const client = makeClient();
    const { container } = render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(AnalyticsDashboard, {}),
      })
    );
    expect(container.querySelector('[aria-label="Loading"]')).toBeDefined();
  });

  it('renders stat cards after data loads', async () => {
    const client = makeClient();
    render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(AnalyticsDashboard, {}),
      })
    );
    await waitFor(() => expect(screen.queryByText('Total Runs')).toBeDefined());
  });

  it('switches to Folders tab and shows folder card', async () => {
    const client = makeClient();
    render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(AnalyticsDashboard, {}),
      })
    );
    await waitFor(() => expect(screen.queryByText('Total Runs')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Folders' }));

    await waitFor(() => expect(screen.queryByText('Demo')).toBeDefined());
  });
});
