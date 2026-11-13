import { useCallback, useState } from 'react';
import type { PauseAction } from '@xyne/workflow-sdk';
import type {
  ResumePayload,
  ResumeAction,
  ResumeAttachment,
} from '@xyne/workflow-sdk/common';
import { useWorkflowClient } from './use-workflow-client.js';
import { friendlyMutationError } from '../utils/permissions.js';

export interface UsePauseInteractionOptions {
  executionId: string;
  /**
   * Node-path of the specific gate this interaction resolves. Required when the
   * execution has more than one open gate (concurrent WAITs in a PARALLEL);
   * omit for a single open gate (the server resolves it).
   */
  nodePath?: string | undefined;
  onResume?: ((action?: PauseAction) => void) | undefined;
}

export interface UsePauseInteractionReturn {
  /** Execute an action — sends form data for non-abort actions, aborts for abort actions. */
  executeAction: (action: PauseAction, formValues?: Record<string, unknown>) => Promise<void>;
  isSubmitting: boolean;
  error: Error | null;
}

const VALID_ACTIONS: ReadonlySet<ResumeAction> = new Set<ResumeAction>([
  'approve',
  'retry',
  'abort',
]);

/**
 * Map a pause-action key onto a valid `ResumeAction`. Unknown keys fall back
 * to `'approve'` — the safe "continue" default for mid-execution pauses.
 */
function resolveResumeAction(key: string): ResumeAction {
  return VALID_ACTIONS.has(key as ResumeAction) ? (key as ResumeAction) : 'approve';
}

/**
 * Split raw form values into the typed `ResumePayload` slots.
 * Known fields (`feedback`, `attachments`) live on the payload root; everything
 * else goes into `data` so step-specific fields survive the router's
 * shape validation.
 */
function buildResumePayload(
  action: ResumeAction,
  formValues: Record<string, unknown> | undefined,
): ResumePayload {
  const payload: ResumePayload = { action };
  if (!formValues) return payload;

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formValues)) {
    if (key === 'feedback') {
      if (typeof value === 'string' && value.length > 0) payload.feedback = value;
    } else if (key === 'attachments') {
      if (Array.isArray(value) && value.length > 0) {
        payload.attachments = value as ResumeAttachment[];
      }
    } else {
      rest[key] = value;
    }
  }
  if (Object.keys(rest).length > 0) payload.data = rest;
  return payload;
}

export function usePauseInteraction(opts: UsePauseInteractionOptions): UsePauseInteractionReturn {
  const { executionId, nodePath, onResume } = opts;
  const client = useWorkflowClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const executeAction = useCallback(
    async (action: PauseAction, formValues?: Record<string, unknown>) => {
      setIsSubmitting(true);
      setError(null);
      // Target this specific gate when known (multi-gate executions require it).
      const gate = nodePath ? { nodePath } : {};
      try {
        if (action.abort) {
          await client.executions.resume(executionId, { abort: true, ...gate });
        } else {
          const resumeAction = resolveResumeAction(action.key);
          const data = buildResumePayload(
            resumeAction,
            action.submitsForm !== false ? formValues : undefined,
          );
          await client.executions.resume(executionId, { data, ...gate });
        }
        onResume?.(action);
      } catch (err) {
        setError(new Error(friendlyMutationError(err)));
        // Only a failure re-enables the actions. A resume returns once it is
        // queued, while the gate still reads as paused, so re-enabling on success
        // invites a second answer the server rejects. The panel unmounts when the
        // gate closes, which resets this.
        setIsSubmitting(false);
      }
    },
    [client, executionId, nodePath, onResume],
  );

  return { executeAction, isSubmitting, error };
}
