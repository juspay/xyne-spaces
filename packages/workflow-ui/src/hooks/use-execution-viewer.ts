import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import type { PauseState } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { buildStepStates, patchExecutionStep, type StepExecutionState } from '../utils/step-state.js';

// The step-state model lives in `utils/step-state.ts` (pure, shared by the graph,
// Journey, detail panel and iteration grouping). Re-exported here for the package's
// public API (`hooks/index.ts`) and existing import sites.
export type { StepExecutionState, StepExecutionStatus } from '../utils/step-state.js';

export type ExecutionViewerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';

// ─── Hook ───

export interface UseExecutionViewerOptions {
  executionId: string;
}

export interface UseExecutionViewerReturn {
  execution: ExecutionDetail | undefined;
  /** False when the live stream is not carrying this run; the view is a snapshot. */
  isLive: boolean;
  isLoading: boolean;
  error: Error | null;
  stepStates: Map<string, StepExecutionState>;
  triggerData: Record<string, unknown> | undefined;
  activeStepName: string | null;
  status: ExecutionViewerStatus;
  selectedStepName: string | null;
  selectStep: (stepName: string | null) => void;
  refetch: () => void;
  stepEvents: Map<string, ActivityEvent[]>;
}

export interface ActivityEvent {
  type: string;
  data: unknown;
  createdAt?: string;
}

function mapStatus(rawStatus: string): ExecutionViewerStatus {
  switch (rawStatus) {
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'CANCELLED': return 'cancelled';
    case 'EXTERNAL_WAIT': return 'paused';
    case 'RUNNING': return 'running';
    default: return 'pending';
  }
}

export function useExecutionViewer(opts: UseExecutionViewerOptions): UseExecutionViewerReturn {
  const { executionId } = opts;
  const client = useWorkflowClient();

  const [execution, setExecution] = useState<ExecutionDetail | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedStepName, setSelectedStepName] = useState<string | null>(null);
  const [stepEvents, setStepEvents] = useState<Map<string, ActivityEvent[]>>(new Map());
  const [overrideStatus, setOverrideStatus] = useState<ExecutionViewerStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /**
   * Whether the live stream is up.
   *
   * State, not a ref. It used to be a ref set inside an SSE listener, which the
   * REST fallback effect read at mount — before the stream could possibly have
   * opened. So the fallback always ran: every viewer did a full `executions.get`
   * it did not need, and then a second one for the trigger payload, and then
   * started a 3-second poll on top of a working stream.
   */
  // State rather than a ref: the REST read below depends on it, so a stream
  // that never connects triggers the fallback by transitioning to 'failed'.
  const [streamState, setStreamState] = useState<'connecting' | 'open' | 'failed'>('connecting');
  const [fetchedTriggerData, setFetchedTriggerData] = useState<Record<string, unknown> | undefined>(undefined);

  // `execution.steps` (node-path-keyed records) is the single source of truth —
  // set by snapshot/poll, then patched incrementally by node-path-aware SSE events
  // (see the handlers below). BOTH views derive from it: the graph aggregates to
  // bare ids here; MAP lanes group by iteration. No separate mutable step-state.
  const stepStates = useMemo(
    () => (execution ? buildStepStates(execution) : new Map<string, StepExecutionState>()),
    [execution],
  );

  // Derive status from execution or override (SSE events update override)
  const status = overrideStatus ?? (execution ? mapStatus(execution.status) : 'pending');

  // ─── SSE connection ───
  useEffect(() => {
    const sseUrl = `${client.baseUrl.replace(/\/+$/, '')}/executions/${executionId}/stream`;
    let es: EventSource | null = null;

    try {
      es = new EventSource(sseUrl);
    } catch {
      // EventSource not available — fall back to polling
      return;
    }

    let opened = false;

    es.addEventListener('snapshot', (e: MessageEvent) => {
      opened = true;
      setStreamState('open');
      try {
        const detail = JSON.parse(e.data as string) as ExecutionDetail;
        setExecution(detail);
        setOverrideStatus(mapStatus(detail.status));
        setIsLoading(false);
        setError(null);
      } catch {
        // ignore parse errors
      }
    });

    // Each lifecycle event patches the exact node-path record in `execution.steps`
    // (upsert by `nodePath`, falling back to the bare `stepName` for top-level
    // steps / older servers). `stepStates` and the MAP lanes both re-derive from
    // it — one source, no separate aggregate to keep in sync, no refetch.
    es.addEventListener('step_started', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { stepName: string; stepType: string; nodePath?: string };
        setExecution((prev) => patchExecutionStep(prev, data.nodePath ?? data.stepName, {
          status: 'RUNNING',
          executorType: data.stepType,
          dataMerge: { type: data.stepType },
        }));
        setOverrideStatus('running');
      } catch { /* ignore */ }
    });

    es.addEventListener('step_completed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { stepName: string; output: Record<string, unknown>; nodePath?: string };
        setExecution((prev) => patchExecutionStep(prev, data.nodePath ?? data.stepName, {
          status: 'COMPLETED',
          dataMerge: { output: data.output },
        }));
      } catch { /* ignore */ }
    });

    es.addEventListener('step_progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as {
          stepName: string;
          type: string;
          payload: unknown;
        };
        // Keyed by bare id — live-activity hints aren't per-iteration (yet).
        setStepEvents((prev) => {
          const next = new Map(prev);
          const list = next.get(data.stepName) ?? [];
          next.set(data.stepName, [...list, { type: data.type, data: data.payload }]);
          return next;
        });
      } catch { /* ignore */ }
    });

    es.addEventListener('step_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { stepName: string; error: string; nodePath?: string };
        setExecution((prev) => patchExecutionStep(prev, data.nodePath ?? data.stepName, {
          status: 'FAILED',
          dataMerge: { error: data.error },
        }));
      } catch { /* ignore */ }
    });

    es.addEventListener('execution_paused', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { stepName: string; pauseState: PauseState; nodePath?: string };
        setExecution((prev) => patchExecutionStep(prev, data.nodePath ?? data.stepName, {
          status: 'EXTERNAL_WAIT',
          dataMerge: { pauseState: data.pauseState },
        }));
        setOverrideStatus('paused');
      } catch { /* ignore */ }
    });

    es.addEventListener('execution_completed', () => {
      setOverrideStatus('completed');
      es?.close();
    });

    es.addEventListener('execution_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { error: string };
        setError(new Error(data.error));
      } catch { /* ignore */ }
      setOverrideStatus('failed');
      es?.close();
    });

    es.addEventListener('execution_cancelled', () => {
      setOverrideStatus('cancelled');
      es?.close();
    });

    es.onerror = () => {
      if (!opened) {
        setStreamState('failed');
        es?.close();
      }
      // If it connected before, EventSource will auto-reconnect.
    };

    return () => {
      es?.close();
    };
  }, [client.baseUrl, executionId]);

  // ─── The REST read ───
  //
  // Runs three times at most: on mount, again if the stream gives up, and again
  // on an explicit `refetch()`. It also supplies `triggerData`, which the
  // snapshot frame does not carry. While the stream is up the node-path patches
  // above keep the record current, so there is nothing to poll for.
  useEffect(() => {
    const controller = new AbortController();
    // `refreshKey` starts at 0 and only ever advances via `refetch()`.
    const isRefetch = refreshKey > 0;
    // A stream failure makes whatever is held arbitrarily old, so replace it.
    // A refetch replaces only when the stream is not carrying the run: while it
    // is, the read can land after newer patches and would roll them back — a
    // resumed gate snapping back to paused because the read predates the worker.
    const replaces = (isRefetch && streamState !== 'open') || streamState === 'failed';

    void (async () => {
      try {
        const detail = await client.executions.get(executionId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        // On first load, and on a refetch while the stream is up, defer to what
        // the stream holds; otherwise the caller asked for the server's answer.
        setExecution((prev) => (replaces ? detail : prev ?? detail));
        const td = (detail as { triggerData?: unknown }).triggerData;
        if (td && typeof td === 'object') setFetchedTriggerData(td as Record<string, unknown>);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        // A failed read only matters when the stream is not carrying the run.
        if (streamState !== 'open') {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => { controller.abort(); };
    return () => { controller.abort(); };
  }, [client, executionId, refreshKey, streamState]);

  const activeStepName = useMemo(() => {
    for (const [name, state] of stepStates) {
      if (state.status === 'running' || state.status === 'paused') return name;
    }
    return null;
  }, [stepStates]);

  const selectStep = useCallback((name: string | null) => {
    setSelectedStepName(name);
  }, []);

  const refetch = useCallback(() => {
    // Deliberate refresh after an explicit action (resume/cancel). Under SSE, live
    // updates already arrive via incremental node-path patches, so this is mainly
    // for the polling-fallback path (the bumped key re-runs the fetch effect).
    setOverrideStatus(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const execTriggerData = execution?.triggerData as Record<string, unknown> | undefined;
  const triggerData = execTriggerData && Object.keys(execTriggerData).length > 0 ? execTriggerData : fetchedTriggerData;

  return {
    execution,
    isLive: streamState === 'open',
    isLoading,
    error,
    stepStates,
    triggerData,
    activeStepName,
    status,
    selectedStepName,
    selectStep,
    refetch,
    stepEvents,
  };
}

