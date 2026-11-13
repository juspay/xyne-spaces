import { useCallback, useState } from 'react';
import type { RerunInput } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { friendlyMutationError } from '../utils/permissions.js';

export interface UseExecutionRerunOptions {
  /** The source execution ID — the one being rerun. */
  executionId: string;
  /** Called with the new execution ID after a successful rerun. */
  onSuccess?: ((newExecutionId: string) => void) | undefined;
}

export interface UseExecutionRerunReturn {
  /** Trigger the rerun with the given options. */
  rerun: (input: RerunInput) => Promise<string | undefined>;
  /** New execution ID after a successful rerun, or null. Cleared on each call. */
  newExecutionId: string | null;
  isSubmitting: boolean;
  error: Error | null;
  /** Reset error + newExecutionId state — useful before retrying. */
  reset: () => void;
}

/**
 * Wraps `client.executions.rerun()` with submission + error state for UI use.
 *
 * Re-runs the source execution starting at `input.fromStepId`, using the
 * source's cached outputs for prior steps. Returns the new execution ID on
 * success; calls `onSuccess` with it so the consumer can navigate.
 */
export function useExecutionRerun(
  opts: UseExecutionRerunOptions,
): UseExecutionRerunReturn {
  const { executionId, onSuccess } = opts;
  const client = useWorkflowClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [newExecutionId, setNewExecutionId] = useState<string | null>(null);

  const rerun = useCallback(
    async (input: RerunInput): Promise<string | undefined> => {
      setIsSubmitting(true);
      setError(null);
      setNewExecutionId(null);
      try {
        const result = await client.executions.rerun(executionId, input);
        setNewExecutionId(result.executionId);
        onSuccess?.(result.executionId);
        return result.executionId;
      } catch (err) {
        setError(new Error(friendlyMutationError(err)));
        return undefined;
      } finally {
        setIsSubmitting(false);
      }
    },
    [client, executionId, onSuccess],
  );

  const reset = useCallback(() => {
    setError(null);
    setNewExecutionId(null);
  }, []);

  return { rerun, newExecutionId, isSubmitting, error, reset };
}
