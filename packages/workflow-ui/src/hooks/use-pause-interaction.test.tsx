import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../components/provider/WorkflowUIProvider.js';
import { usePauseInteraction } from './use-pause-interaction.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

/**
 * A resume returns once it is queued, while the gate still reads as paused. The
 * actions must stay disabled through that window, or a second click sends an
 * answer the server rejects ("not paused" / "already has an answer").
 */
function setup(resume: ReturnType<typeof vi.fn>) {
  const client = { baseUrl: 'http://localhost', executions: { resume } } as unknown as WorkflowClient;
  const onResume = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(WorkflowUIProvider, { client }, children);
  const hook = renderHook(
    () => usePauseInteraction({ executionId: 'e1', nodePath: 'gate', onResume }),
    { wrapper },
  );
  return { hook, onResume };
}

describe('usePauseInteraction', () => {
  it('stays submitting after a successful resume', async () => {
    const { hook, onResume } = setup(vi.fn().mockResolvedValue({ resumed: true }));

    await act(() => hook.result.current.executeAction({ key: 'approve', label: 'Continue' }));

    expect(onResume).toHaveBeenCalledOnce();
    expect(hook.result.current.isSubmitting).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it('stays submitting after a successful abort', async () => {
    const { hook } = setup(vi.fn().mockResolvedValue({ resumed: true }));

    await act(() => hook.result.current.executeAction({ key: 'stop', label: 'Stop', abort: true }));

    expect(hook.result.current.isSubmitting).toBe(true);
  });

  it('re-enables the actions when the resume fails', async () => {
    const { hook, onResume } = setup(vi.fn().mockRejectedValue(new Error('boom')));

    await act(() => hook.result.current.executeAction({ key: 'approve', label: 'Continue' }));

    expect(onResume).not.toHaveBeenCalled();
    expect(hook.result.current.isSubmitting).toBe(false);
    expect(hook.result.current.error).not.toBeNull();
  });
});
