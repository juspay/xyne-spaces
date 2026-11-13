import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../components/provider/WorkflowUIProvider.js';
import { useExecutionViewer } from './use-execution-viewer.js';
import type { ExecutionDetail, WorkflowClient } from '@xyne/workflow-sdk/client';

/** Just enough of EventSource to drive the hook's listeners by hand. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (e: MessageEvent) => void>();
  constructor() { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners.set(type, fn); }
  close() {}
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const detail = (gateStatus: string, execStatus = 'EXTERNAL_WAIT') => ({
  id: 'e1',
  status: execStatus,
  steps: [{
    stepName: 'gate',
    status: gateStatus,
    executorType: 'WAIT',
    data: JSON.stringify({ type: 'WAIT', output: {}, pauseState: { reason: 'Check' } }),
  }],
  config: { steps: [{ id: 'gate', type: 'WAIT', config: {} }] },
}) as unknown as ExecutionDetail;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function render(get: ReturnType<typeof vi.fn>) {
  const client = { baseUrl: 'http://localhost', executions: { get } } as unknown as WorkflowClient;
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(WorkflowUIProvider, { client }, children);
  return renderHook(() => useExecutionViewer({ executionId: 'e1' }), { wrapper });
}

describe('useExecutionViewer refetch', () => {
  beforeEach(() => { vi.stubGlobal('EventSource', FakeEventSource); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not roll a live stream back to an older read', async () => {
    // The resume flow: the gate is answered, `onResumed` refetches, the worker
    // closes the gate and the stream says so — and only then does the read land,
    // taken before the worker ran.
    let late: ReturnType<typeof deferred<ExecutionDetail>> | undefined;
    const get = vi.fn(() => late?.promise ?? Promise.resolve(detail('EXTERNAL_WAIT')));
    const { result } = render(get);

    act(() => { FakeEventSource.last!.emit('snapshot', detail('EXTERNAL_WAIT')); });
    await waitFor(() => expect(result.current.isLive).toBe(true));
    expect(result.current.stepStates.get('gate')?.status).toBe('paused');

    late = deferred<ExecutionDetail>();
    act(() => { result.current.refetch(); });
    act(() => { FakeEventSource.last!.emit('step_completed', { stepName: 'gate', nodePath: 'gate', output: {} }); });
    expect(result.current.stepStates.get('gate')?.status).toBe('completed');

    await act(async () => { late!.resolve(detail('EXTERNAL_WAIT')); await late!.promise; });

    expect(result.current.stepStates.get('gate')?.status).toBe('completed');
  });

  it('still takes the server read when the stream is not carrying the run', async () => {
    let next = detail('EXTERNAL_WAIT');
    const get = vi.fn(() => Promise.resolve(next));
    const { result } = render(get);

    await waitFor(() => expect(result.current.stepStates.get('gate')?.status).toBe('paused'));

    next = detail('COMPLETED', 'RUNNING');
    act(() => { result.current.refetch(); });

    await waitFor(() => expect(result.current.stepStates.get('gate')?.status).toBe('completed'));
  });
});
