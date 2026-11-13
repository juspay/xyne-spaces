import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { ApprovalsView } from './ApprovalsView.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

const HOUR = 3_600_000;
const row = (id: string, name: string, dueOffset?: number) => ({
  id, workflowId: `wf-${id}`, workflowName: name,
  runName: `Run ${id}`,
  pausedStepName: 'gate_r', pausedNodePath: 'gate_r',
  createdAt: new Date(Date.now() - 30 * 24 * HOUR),
  ...(dueOffset !== undefined ? { dueAt: new Date(Date.now() + dueOffset) } : {}),
});

/** Overdue holds one late gate; Due today holds nothing; All holds both kinds. */
function makeClient() {
  const late = row('a1', 'test-parallel-approvals', -30 * 24 * HOUR);
  const fresh = row('a2', 'no-deadline-one');
  const listPendingApprovals = vi.fn().mockImplementation((p: { bucket?: string }) =>
    Promise.resolve({
      items: p.bucket === 'overdue' ? [late] : p.bucket === 'dueToday' ? [] : [late, fresh],
      nextCursor: undefined,
    }),
  );
  const countPendingApprovals = vi.fn().mockImplementation((p?: { bucket?: string }) =>
    Promise.resolve(p?.bucket === 'overdue' ? 1 : p?.bucket === 'dueToday' ? 0 : 2),
  );
  const client = {
    baseUrl: 'http://localhost',
    executions: {
      listPendingApprovals,
      countPendingApprovals,
      pendingApprovalFacets: vi.fn().mockResolvedValue({ workflows: [], stages: [], tags: [] }),
      get: vi.fn(),
    },
  } as unknown as WorkflowClient;
  return { client, listPendingApprovals };
}

const rowsOnScreen = () => screen.queryAllByText('test-parallel-approvals').length;
const pill = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

describe('ApprovalsView pills', () => {
  it('shows only the chosen bucket, and never accumulates across switches', async () => {
    const { client } = makeClient();
    render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(ApprovalsView, {}),
      }),
    );

    // All: both rows.
    await waitFor(() => expect(rowsOnScreen()).toBe(1));
    expect(screen.getByText('no-deadline-one')).toBeTruthy();

    // Bounce between pills the way a reader would, and count every time.
    const seen: string[] = [];
    for (const step of ['Overdue', 'Due today', 'Overdue', 'Due today', 'All', 'Due today']) {
      fireEvent.click(pill(step));
      if (step === 'Due today') {
        await waitFor(() => expect(screen.getByText('Nothing is due today')).toBeTruthy());
      } else {
        await waitFor(() => expect(rowsOnScreen()).toBeGreaterThan(0));
      }
      seen.push(`${step}=${rowsOnScreen()}`);
    }
    // Due today must be 0 every single time, no matter what came before.
    expect(seen).toEqual([
      'Overdue=1', 'Due today=0', 'Overdue=1', 'Due today=0', 'All=1', 'Due today=0',
    ]);
  });

  it('does not keep the previous pill\'s rows while the next one loads', async () => {
    const { client, listPendingApprovals } = makeClient();
    // Make Due today slow, so the in-flight window is observable.
    let release!: () => void;
    listPendingApprovals.mockImplementation((p: { bucket?: string }) =>
      p.bucket === 'dueToday'
        ? new Promise((res) => { release = () => res({ items: [], nextCursor: undefined }); })
        : Promise.resolve({ items: [row('a1', 'test-parallel-approvals', -HOUR)], nextCursor: undefined }),
    );
    render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(ApprovalsView, {}),
      }),
    );
    await waitFor(() => expect(rowsOnScreen()).toBe(1));

    fireEvent.click(pill('Due today'));
    // Fetch is still pending here. The old row must already be gone.
    await waitFor(() => expect(rowsOnScreen()).toBe(0));
    release();
    await waitFor(() => expect(screen.getByText('Nothing is due today')).toBeTruthy());
    expect(rowsOnScreen()).toBe(0);
  });
});

describe('ApprovalsView with a parallel workflow', () => {
  it('does not leak rows when two gates share one execution id', async () => {
    // A parallel branch parks two gates on ONE execution, so the adapter
    // returns two rows with the same `id`. Keyed on the id alone, React
    // cannot tell them apart and leaves orphan DOM behind on every re-render —
    // the "phantom rows" that piled up under the Due today pill.
    const exec = 'lf3o7cbrd1h84jzu7c5guasz';
    const left = { ...row(exec, 'test-parallel-approvals', -30 * 24 * HOUR), pausedNodePath: 'par:left#0/gate_l' };
    const right = { ...row(exec, 'test-parallel-approvals', -30 * 24 * HOUR), pausedNodePath: 'par:right#0/gate_r' };
    const listPendingApprovals = vi.fn().mockImplementation((p: { bucket?: string }) =>
      Promise.resolve({ items: p.bucket === 'dueToday' ? [] : [left, right], nextCursor: undefined }),
    );
    const client = {
      baseUrl: 'http://localhost',
      executions: {
        listPendingApprovals,
        countPendingApprovals: vi.fn().mockImplementation((p?: { bucket?: string }) =>
          Promise.resolve(p?.bucket === 'dueToday' ? 0 : 2)),
        pendingApprovalFacets: vi.fn().mockResolvedValue({ workflows: [], stages: [], tags: [] }),
        get: vi.fn(),
      },
    } as unknown as WorkflowClient;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(ApprovalsView, {}),
      }),
    );
    await waitFor(() => expect(rowsOnScreen()).toBe(2));

    const counts: number[] = [];
    for (const step of ['Due today', 'Overdue', 'Due today', 'All', 'Due today']) {
      fireEvent.click(pill(step));
      if (step === 'Due today') await waitFor(() => expect(screen.getByText('Nothing is due today')).toBeTruthy());
      else await waitFor(() => expect(rowsOnScreen()).toBeGreaterThan(0));
      counts.push(rowsOnScreen());
    }
    expect(counts).toEqual([0, 2, 0, 2, 0]);
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('same key'))).toEqual([]);
    errors.mockRestore();
  });
});

describe('ApprovalsView scroll paging', () => {
  it('loads the next page when the end of the list comes into view — no button', async () => {
    // jsdom has no IntersectionObserver; this stand-in lets the test decide
    // when the end-of-list marker is "visible".
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    const RealIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
    };

    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => row(`r${String(from + i)}`, `wf-${String(from + i)}`));
    const listPendingApprovals = vi.fn().mockImplementation((p: { cursor?: string }) =>
      Promise.resolve(p.cursor ? { items: page(25, 10), nextCursor: undefined } : { items: page(0, 25), nextCursor: 'c1' }),
    );
    const client = {
      baseUrl: 'http://localhost',
      executions: {
        listPendingApprovals,
        countPendingApprovals: vi.fn().mockResolvedValue(35),
        pendingApprovalFacets: vi.fn().mockResolvedValue({ workflows: [], stages: [], tags: [] }),
        get: vi.fn(),
      },
    } as unknown as WorkflowClient;

    render(
      React.createElement(WorkflowUIProvider, {
        client,
        children: React.createElement(ApprovalsView, {}),
      }),
    );
    await waitFor(() => expect(screen.getByText('wf-24')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();

    // The reader scrolls to the bottom: the marker becomes visible.
    observers.at(-1)?.([{ isIntersecting: true }]);

    await waitFor(() => expect(screen.getByText('wf-34')).toBeTruthy());
    expect(listPendingApprovals.mock.calls.some((c) => (c[0] as { cursor?: string }).cursor === 'c1')).toBe(true);
    expect(screen.getByText('Showing 35 of 35 approvals')).toBeTruthy();

    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = RealIO;
  });
});

describe('ApprovalsView row', () => {
  it('leads with the run name, with the step and the workflow beneath it', async () => {
    const { client } = makeClient();
    render(React.createElement(WorkflowUIProvider, { client }, React.createElement(ApprovalsView, {})));

    // The run name is the row's title…
    const title = await screen.findByText('Run a1');
    expect(title.tagName).toBe('P');
    // …and the workflow is context on the line below, labelled.
    const row = title.closest('button')!;
    expect(within(row).getByText(/Waiting at:/)).toBeTruthy();
    expect(within(row).getByText(/Workflow:/)).toBeTruthy();
    expect(within(row).getByText('test-parallel-approvals')).toBeTruthy();
  });
});
